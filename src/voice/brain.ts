// Nemotron as the live brain of a phone call. Transport-agnostic: the LiveKit agent (voice/agent.ts) and the
// mock caller both drive this same class, so mock mode exercises the real conversation logic.
//
// Safety is enforced in code around the model:
//   1. The 3 fixed safety questions are always asked first, verbatim.
//   2. Every user turn is keyword-scanned; danger → 911 line, end call, mark critical + escalate mid-call.
//   3. If Nemotron is slow or returns junk, we speak the next scripted question instead.
import { chatJSON } from "../agents/nemotron.js";
import { CORE_QUESTIONS, EMERGENCY_LINE, detectDanger } from "../agents/safety.js";
import type { CallScript } from "../agents/triage.js";
import { ctxEventType, ctxName, logAgent, type Id, type Row } from "../repo.js";

export interface Turn { role: "agent" | "user"; content: string }
export interface BrainReply { say: string; endCall: boolean }

export interface CallSession {
  alertId: Id | null;
  personId: Id | null;
  attemptId: Id | null;
  ctx: Row;
  script: CallScript;
}

// attemptId → session, registered by the pipeline right before a call is placed.
const sessions = new Map<string, CallSession>();
export const registerCallSession = (s: CallSession) => sessions.set(String(s.attemptId), s);
export const getCallSession = (attemptId: Id) => sessions.get(String(attemptId));
export const dropCallSession = (attemptId: Id) => sessions.delete(String(attemptId));

const MAX_FOLLOWUPS = 3;
const ACK_TIMEOUT_MS = Number(process.env.VOICE_ACK_TIMEOUT_MS ?? 1500);
const TURN_TIMEOUT_MS = Number(process.env.VOICE_TURN_TIMEOUT_MS ?? 3500);

const withTimeout = <T>(p: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

const transcriptText = (t: Turn[]) => t.map((x) => `${x.role === "agent" ? "Assistant" : "Caller"}: ${x.content}`).join("\n");

function profileSummary(ctx: Row) {
  const p = ctx.profile ?? ctx.person ?? {};
  return JSON.stringify({
    name: ctxName(ctx), event: ctxEventType(ctx), household: p.household_size ?? p.household,
    age: p.age, medical: p.medical_needs ?? p.medical, saferoom: ctx.saferoom ?? ctx.safe_room ?? null,
  });
}

export class CallBrain {
  private coreIdx = 0;
  private followups = 0;
  private lastAsked = "";
  private dangerHandled = false;
  constructor(private s: CallSession, private onDanger?: (userText: string, matched: string[]) => Promise<void>) {}

  /** First thing said when the call connects. */
  opening(): BrainReply {
    this.coreIdx = 1;
    this.lastAsked = CORE_QUESTIONS[0];
    return { say: `${this.s.script.opening} ${CORE_QUESTIONS[0]}`, endCall: false };
  }

  /** Caller went quiet. */
  reminder(): BrainReply {
    return { say: `Are you still there? ${this.lastAsked}`, endCall: false };
  }

  async reply(transcript: Turn[]): Promise<BrainReply> {
    const lastUser = [...transcript].reverse().find((t) => t.role === "user")?.content ?? "";

    // (2) Danger always wins.
    const danger = detectDanger(lastUser);
    if (danger.danger) {
      if (!this.dangerHandled) {
        this.dangerHandled = true;
        this.log(`DANGER on live call [${danger.matched.join(", ")}] — giving 911 instruction and escalating`, { lastUser });
        await this.onDanger?.(lastUser, danger.matched).catch((e) => console.error("onDanger", e));
      }
      return { say: `${EMERGENCY_LINE} I'm alerting emergency responders to your address right now.`, endCall: true };
    }

    // (1) Fixed safety questions, verbatim, with a short Nemotron acknowledgement.
    if (this.coreIdx < CORE_QUESTIONS.length) {
      const q = CORE_QUESTIONS[this.coreIdx++];
      const ack = await this.ack(transcript);
      this.lastAsked = q;
      return { say: `${ack} ${q}`, endCall: false };
    }

    // Follow-up phase: Nemotron leads, bounded by MAX_FOLLOWUPS.
    if (this.followups < MAX_FOLLOWUPS) {
      const planned = this.s.script.questions.slice(CORE_QUESTIONS.length);
      const llm = await withTimeout(
        chatJSON(
          `You are the State Farm SafeNet assistant on a LIVE phone call with a policyholder during a disaster.
The fixed safety questions are done. Now ask at most ${MAX_FOLLOWUPS - this.followups} more short follow-up question(s), ONE per turn,
responding naturally to what they just said. Planned follow-ups (use, adapt, or skip): ${JSON.stringify(planned)}.
Rules: under 30 words, warm and calm, no medical/legal/claims advice (say a State Farm agent will follow up on claims).
If you have what responders need, set done=true and say a brief thank-you.
JSON: {"say": "...", "done": boolean}`,
          `Caller profile: ${profileSummary(this.s.ctx)}\n\nCall so far:\n${transcriptText(transcript).slice(-4000)}`,
          (x: any) => (typeof x?.say === "string" && x.say.length > 0 && x.say.length < 400 && typeof x?.done === "boolean" ? x : null),
        ),
        TURN_TIMEOUT_MS,
      );
      if (llm) {
        this.log(llm.done ? "Nemotron: enough information — wrapping up" : "Nemotron chose next follow-up", { say: llm.say });
        if (llm.done) return { say: `${llm.say} ${this.s.script.closing}`, endCall: true };
        this.followups++;
        this.lastAsked = llm.say;
        return { say: llm.say, endCall: false };
      }
      // (3) Fallback: next scripted question.
      const next = planned[this.followups++];
      if (next) {
        this.log("Nemotron slow/unavailable — using scripted follow-up", { say: next });
        this.lastAsked = next;
        return { say: `Thank you. ${next}`, endCall: false };
      }
    }

    return { say: this.s.script.closing, endCall: true };
  }

  private async ack(transcript: Turn[]): Promise<string> {
    const r = await withTimeout(
      chatJSON(
        `You are on a live disaster check-in call. Write a very short, calm acknowledgement (max 12 words) of what the
caller just said. Do NOT ask a question. JSON: {"ack": "..."}`,
        transcriptText(transcript.slice(-4)),
        (x: any) => (typeof x?.ack === "string" && x.ack.length < 120 && !x.ack.includes("?") ? (x.ack as string) : null),
      ),
      ACK_TIMEOUT_MS,
    );
    return r ?? "Thank you.";
  }

  private log(thought: string, output?: unknown) {
    if (this.s.alertId == null) return console.log(`[voice] ${thought}`);
    void logAgent({ alertId: this.s.alertId, personId: this.s.personId, agent: "triage", tool: "live_call", thought, output });
  }
}
