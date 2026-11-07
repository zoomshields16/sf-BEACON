import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { logAgent, type AgentLogEntry, type Id } from "../repo.js";

export const nemotronEnabled = () => Boolean(process.env.NVIDIA_API_KEY && process.env.NEMOTRON_MODEL);

let client: OpenAI | null = null;
function getClient() {
  client ??= new OpenAI({
    apiKey: process.env.NVIDIA_API_KEY,
    // Hosted API by default; point at a Nemotron NIM on Brev with NEMOTRON_BASE_URL.
    baseURL: process.env.NEMOTRON_BASE_URL || "https://integrate.api.nvidia.com/v1",
    timeout: 30_000,
    maxRetries: 1,
  });
  return client;
}

// Some Nemotron models toggle reasoning via the system prompt (e.g. "/no_think" or
// "detailed thinking off"). Set NEMOTRON_SYSTEM_PREFIX if tool calls are flaky.
const withPrefix = (system: string) =>
  process.env.NEMOTRON_SYSTEM_PREFIX ? `${process.env.NEMOTRON_SYSTEM_PREFIX}\n${system}` : system;

// Nemotron 3.5 reasons by default (seconds per reply). Off everywhere for latency; the coordinator can opt in
// with NEMOTRON_COORDINATOR_THINKING=true (its reasoning then shows up in the agent log).
const thinking = (on: boolean) => ({ chat_template_kwargs: { enable_thinking: on } }) as Record<string, unknown>;

// ---------- request queue: bounded concurrency, priority lanes, retry on 429 ----------
// "high" = a real phone call (someone is waiting on the line), "normal" = coordinator/triage, "low" = simulated calls.
export type Priority = "high" | "normal" | "low";
const RANK: Record<Priority, number> = { high: 0, normal: 1, low: 2 };
const MAX_CONCURRENCY = Number(process.env.NEMOTRON_MAX_CONCURRENCY ?? 3);
let active = 0;
const waiting: { rank: number; go: () => void }[] = [];

async function acquire(priority: Priority) {
  if (active < MAX_CONCURRENCY && waiting.length === 0) { active++; return; }
  await new Promise<void>((go) => {
    waiting.push({ rank: RANK[priority], go });
    waiting.sort((a, b) => a.rank - b.rank);
  });
  active++;
}
function release() {
  active--;
  waiting.shift()?.go();
}

type CreateParams = Parameters<OpenAI["chat"]["completions"]["create"]>[0];
async function create(params: CreateParams, priority: Priority = "normal"): Promise<OpenAI.Chat.Completions.ChatCompletion> {
  await acquire(priority);
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        return (await getClient().chat.completions.create({ ...params, stream: false } as any)) as OpenAI.Chat.Completions.ChatCompletion;
      } catch (err: any) {
        if (err?.status !== 429 || attempt >= 2 || priority === "low") throw err;
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1) + Math.random() * 200));
      }
    }
  } finally {
    release();
  }
}

/** Pulls the first JSON object out of model text (strips <think> blocks and code fences). */
export function extractJson(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(json)?/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** One-shot JSON completion. Returns null on any API error or invalid output — callers must fall back. */
export async function chatJSON<T>(
  system: string,
  user: string,
  validate: (x: unknown) => T | null,
  priority: Priority = "normal",
): Promise<T | null> {
  if (!nemotronEnabled()) return null;
  try {
    const res = await create({
      model: process.env.NEMOTRON_MODEL!,
      temperature: 0.2,
      max_tokens: 1024,
      ...thinking(false),
      messages: [
        { role: "system", content: withPrefix(system + "\nRespond with a single JSON object only.") },
        { role: "user", content: user },
      ],
    }, priority);
    return validate(extractJson(res.choices[0]?.message?.content ?? ""));
  } catch (err) {
    console.error("nemotron chatJSON error:", (err as Error).message);
    return null;
  }
}

/** Plain text completion; null on error. */
export async function chatText(system: string, user: string, priority: Priority = "normal"): Promise<string | null> {
  if (!nemotronEnabled()) return null;
  try {
    const res = await create({
      model: process.env.NEMOTRON_MODEL!,
      temperature: 0.3,
      max_tokens: 400,
      ...thinking(false),
      messages: [
        { role: "system", content: withPrefix(system) },
        { role: "user", content: user },
      ],
    }, priority);
    const text = (res.choices[0]?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    return text || null;
  } catch (err) {
    console.error("nemotron chatText error:", (err as Error).message);
    return null;
  }
}

// ---------- ReAct loop with real tool calling ----------
export interface ToolContext {
  alertId: Id;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  run: (args: any, ctx: ToolContext) => Promise<unknown>;
}

/** Human-readable line for a tool call when the model didn't write its own thought. */
function describe(tool: string, args: any, out: any): string {
  try {
    switch (tool) {
      case "get_call_queue": {
        const rows = Array.isArray(out) ? out : [];
        const top = rows.slice(0, 3).map((r: any) => `${r.name} (${r.priority})`).join(", ");
        return `Pulled call queue: ${rows.length} waiting${top ? ` — top: ${top}` : ""}`;
      }
      case "get_hex_risk": {
        const hot = (Array.isArray(out) ? out : []).filter((h: any) => Number(h.risk) >= 0.5);
        return hot.length ? `Checked flood risk: ${hot.length} high-risk zone(s), worst ${Number(hot[0].risk).toFixed(2)}` : "Checked flood risk: no high-risk zones yet";
      }
      case "get_person_context": {
        const p = out?.profile ?? {};
        const bits = [p.age && `${p.age}`, p.medical_needs, p.mobility_limited && "limited mobility", p.household_size && `household of ${p.household_size}`].filter(Boolean);
        return `Reviewing ${p.name ?? `#${args.person_id}`}${bits.length ? `: ${bits.join(", ")}` : ""}`;
      }
      case "get_call_result": return `Checking call result for #${args.person_id}: ${out?.triage?.status ?? out?.attempt?.status ?? "pending"}`;
      case "escalate_to_911": return `Escalating #${args.person_id} to 911 review: ${args.reason ?? ""}`;
      default: return `${tool}(${JSON.stringify(args).slice(0, 80)})`;
    }
  } catch { return `calling ${tool}`; }
}

const truncate = (v: unknown, n = 3500) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > n ? s.slice(0, n) + "…(truncated)" : s;
};

export async function runAgent(opts: {
  agent: AgentLogEntry["agent"];
  alertId: Id;
  system: string;
  task: string;
  tools: ToolDef[];
  maxSteps?: number;
  /** If the model tries to finish without calling any of these, nudge it once to actually act. */
  mustCallOneOf?: string[];
}): Promise<{ ok: boolean; final: string | null; toolCalls: number; called: string[] }> {
  const { agent, alertId, tools, maxSteps = 10 } = opts;
  const called: string[] = [];
  let nudged = false;
  if (!nemotronEnabled()) return { ok: false, final: null, toolCalls: 0, called };

  const toolSpecs: ChatCompletionTool[] = tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: withPrefix(opts.system) },
    { role: "user", content: opts.task },
  ];
  let toolCalls = 0;
  const coordinatorThinking = agent === "coordinator" && process.env.NEMOTRON_COORDINATOR_THINKING === "true";

  try {
    for (let step = 0; step < maxSteps; step++) {
      const res = await create({
        model: process.env.NEMOTRON_MODEL!,
        temperature: 0.2,
        max_tokens: coordinatorThinking ? 4096 : 1024,
        ...thinking(coordinatorThinking),
        messages,
        tools: toolSpecs,
        tool_choice: "auto",
      });
      const msg = res.choices[0]?.message;
      if (!msg) break;
      messages.push(msg);
      const reasoning = String((msg as any).reasoning_content ?? (msg as any).reasoning ?? "").trim();
      const thought = ((msg.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim() || reasoning.slice(-400)).trim();

      if (!msg.tool_calls?.length) {
        const acted = !opts.mustCallOneOf || called.some((c) => opts.mustCallOneOf!.includes(c));
        if (!acted && !nudged) {
          nudged = true;
          messages.push({ role: "user", content: `You described a plan but haven't acted. Call ${opts.mustCallOneOf!.join(" or ")} now for each person you chose.` });
          continue;
        }
        await logAgent({ alertId, agent, thought: thought || "(done)" });
        return { ok: true, final: thought, toolCalls, called };
      }

      for (const call of msg.tool_calls) {
        if (call.type !== "function") continue;
        const tool = tools.find((t) => t.name === call.function.name);
        let args: any = {};
        let output: unknown;
        try {
          args = JSON.parse(call.function.arguments || "{}");
          output = tool ? await tool.run(args, { alertId }) : { error: `unknown tool ${call.function.name}` };
        } catch (err) {
          output = { error: (err as Error).message };
        }
        toolCalls++;
        called.push(call.function.name);
        // place_voice_call / send_text are already logged by the pipeline ("Calling Maria") unless the model explained itself.
        const selfLogged = ["place_voice_call", "send_text"].includes(call.function.name);
        if (thought || !selfLogged) {
          await logAgent({
            alertId,
            personId: args?.person_id ?? null,
            agent,
            thought: thought || describe(call.function.name, args, output),
            tool: call.function.name,
            input: args,
            output,
          });
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: truncate(output) });
      }
    }
    await logAgent({ alertId, agent, thought: `stopped after ${maxSteps} steps` });
    return { ok: true, final: null, toolCalls, called };
  } catch (err) {
    await logAgent({ alertId, agent, thought: `Nemotron error, using fallback: ${(err as Error).message}` });
    return { ok: false, final: null, toolCalls, called };
  }
}
