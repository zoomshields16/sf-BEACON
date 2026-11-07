// LiveKit voice agent worker — run with `npm run agent`. Separate process from the API.
// Photon number ⇄ SIP ⇄ LiveKit room; this agent joins the room. LiveKit Inference does STT/TTS,
// and every reply comes from CallBrain (Nemotron + code-enforced safety) via the llmNode override.
import "dotenv/config";
import { fileURLToPath } from "node:url";
import { ReadableStream } from "node:stream/web";
import { cli, defineAgent, ServerOptions, voice, type JobContext, type llm } from "@livekit/agents";
import * as openai from "@livekit/agents-plugin-openai";
import { RoomServiceClient } from "livekit-server-sdk";
import { CallBrain, type BrainReply, type CallSession, type Turn } from "./brain.js";
import { CORE_QUESTIONS } from "../agents/safety.js";

const API = process.env.INTERNAL_API_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-internal-token": process.env.INTERNAL_TOKEN ?? "" },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} → ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

// Used when the agent is dispatched without an attempt (e.g. a manual test call from the LiveKit console).
const testSession = (): CallSession => ({
  alertId: null, personId: null, attemptId: null, ctx: {},
  script: {
    opening: "Hi, this is the State Farm SafeNet assistant checking on you during the emergency in your area.",
    questions: [...CORE_QUESTIONS, "Do you have power, water, and any medications you need?"],
    closing: "Thank you. If anything changes or you are in danger, call 911.",
    source: "fallback",
  },
});

function lastUserText(chatCtx: llm.ChatContext): string {
  for (let i = chatCtx.items.length - 1; i >= 0; i--) {
    const item: any = chatCtx.items[i];
    if (item?.type === "message" && item.role === "user") return item.textContent ?? "";
  }
  return "";
}

function userTurnCount(chatCtx: llm.ChatContext): number {
  return chatCtx.items.filter((i: any) => i?.type === "message" && i.role === "user").length;
}

class SafeNetCaller extends voice.Agent {
  readonly transcript: Turn[] = [];

  constructor(private brain: CallBrain, private hangup: () => Promise<void>) {
    super({ instructions: "State Farm SafeNet disaster check-in caller. Replies are produced by CallBrain." });
  }

  /** Speak via session.say (used for the opening and for final lines, so we can hang up after playout). */
  private speak(r: BrainReply) {
    this.transcript.push({ role: "agent", content: r.say }); console.log(`AGENT: ${r.say}`);
    const handle = this.session.say(r.say, { allowInterruptions: !r.endCall });
    if (r.endCall) handle.waitForPlayout().then(() => this.hangup()).catch(() => this.hangup());
  }

  async onEnter() {
    this.speak(this.brain.opening());
  }

  private lastTurnKey = "";
  private lastReply: BrainReply | null = null;

  async llmNode(chatCtx: llm.ChatContext, ..._rest: unknown[]): ReturnType<voice.Agent["llmNode"]> {
    const said = lastUserText(chatCtx);
    // LiveKit can invoke llmNode more than once for the same caller turn — never advance the script twice.
    const turnKey = `${userTurnCount(chatCtx)}:${said}`;
    if (turnKey === this.lastTurnKey && this.lastReply && !this.lastReply.endCall) {
      const again = this.lastReply.say;
      return new ReadableStream<string>({ start(c) { c.enqueue(again); c.close(); } });
    }
    this.lastTurnKey = turnKey;
    if (said) { this.transcript.push({ role: "user", content: said }); console.log(`CALLER: ${said}`); }
    const r = await this.brain.reply(this.transcript);
    this.lastReply = r;
    if (r.endCall) {
      this.speak(r);
      return null;
    }
    this.transcript.push({ role: "agent", content: r.say }); console.log(`AGENT: ${r.say}`);
    return new ReadableStream<string>({ start(c) { c.enqueue(r.say); c.close(); } });
  }
}

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const meta = JSON.parse(ctx.job.metadata || "{}") as { attemptId?: string };
    await ctx.connect();

    const session = meta.attemptId
      ? await api<CallSession>(`/internal/calls/${meta.attemptId}`).catch((e) => { console.error(e); return testSession(); })
      : testSession();
    const attempt = session.attemptId;

    let finished = false;
    const finish = async () => {
      if (finished) return;
      finished = true;
      console.log(`\n===== CALL TRANSCRIPT (${ctx.room.name}) =====\n` +
        agent.transcript.map((t) => `${t.role === "agent" ? "AGENT" : "CALLER"}: ${t.content}`).join("\n") + "\n=====\n");
      if (attempt == null) return;
      const answered = agent.transcript.some((t) => t.role === "user");
      await api(`/internal/calls/${attempt}/ended`, { answered, transcript: agent.transcript }).catch(console.error);
    };
    const hangup = async () => {
      await finish();
      const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
      if (LIVEKIT_URL && ctx.room.name) {
        await new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET).deleteRoom(ctx.room.name).catch(console.error);
      }
    };

    const brain = new CallBrain(session, async (text, matched) => {
      if (attempt != null) await api(`/internal/calls/${attempt}/danger`, { text, matched });
    });
    const agent = new SafeNetCaller(brain, hangup);
    ctx.addShutdownCallback(finish);

    const vsession = new voice.AgentSession({
      turnHandling: { preemptiveGeneration: { enabled: false } },
      stt: (process.env.LIVEKIT_STT ?? "deepgram/nova-3") as any,
      tts: (process.env.LIVEKIT_TTS ?? "cartesia/sonic-3") as any,
      // Nominal: replies come from the llmNode override, but the pipeline expects an LLM to be configured.
      llm: new openai.LLM({
        model: process.env.NEMOTRON_MODEL ?? "nemotron",
        baseURL: process.env.NEMOTRON_BASE_URL ?? "https://integrate.api.nvidia.com/v1",
        apiKey: process.env.NVIDIA_API_KEY ?? "unused",
      }),
    });
    await vsession.start({ agent, room: ctx.room });
  },
});

cli.runApp(new ServerOptions({
  agent: fileURLToPath(import.meta.url),
  agentName: process.env.LIVEKIT_AGENT_NAME ?? "safenet-caller",
}));
