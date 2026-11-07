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
): Promise<T | null> {
  if (!nemotronEnabled()) return null;
  try {
    const res = await getClient().chat.completions.create({
      model: process.env.NEMOTRON_MODEL!,
      temperature: 0.2,
      max_tokens: 1024,
      ...thinking(false),
      messages: [
        { role: "system", content: withPrefix(system + "\nRespond with a single JSON object only.") },
        { role: "user", content: user },
      ],
    });
    return validate(extractJson(res.choices[0]?.message?.content ?? ""));
  } catch (err) {
    console.error("nemotron chatJSON error:", (err as Error).message);
    return null;
  }
}

/** Plain text completion; null on error. */
export async function chatText(system: string, user: string): Promise<string | null> {
  if (!nemotronEnabled()) return null;
  try {
    const res = await getClient().chat.completions.create({
      model: process.env.NEMOTRON_MODEL!,
      temperature: 0.3,
      max_tokens: 400,
      ...thinking(false),
      messages: [
        { role: "system", content: withPrefix(system) },
        { role: "user", content: user },
      ],
    });
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
}): Promise<{ ok: boolean; final: string | null; toolCalls: number }> {
  const { agent, alertId, tools, maxSteps = 10 } = opts;
  if (!nemotronEnabled()) return { ok: false, final: null, toolCalls: 0 };

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
      const res = await getClient().chat.completions.create({
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
        await logAgent({ alertId, agent, thought: thought || "(done)" });
        return { ok: true, final: thought, toolCalls };
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
        await logAgent({
          alertId,
          personId: args?.person_id ?? null,
          agent,
          thought: thought || `calling ${call.function.name}`,
          tool: call.function.name,
          input: args,
          output,
        });
        messages.push({ role: "tool", tool_call_id: call.id, content: truncate(output) });
      }
    }
    await logAgent({ alertId, agent, thought: `stopped after ${maxSteps} steps` });
    return { ok: true, final: null, toolCalls };
  } catch (err) {
    await logAgent({ alertId, agent, thought: `Nemotron error, using fallback: ${(err as Error).message}` });
    return { ok: false, final: null, toolCalls };
  }
}
