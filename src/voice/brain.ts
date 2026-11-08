// Nemotron as the live brain of a phone call. Transport-agnostic: the LiveKit agent (voice/agent.ts) and the
// mock caller both drive this same class, so mock mode exercises the real conversation logic.
//
// Safety is enforced in code around the model:
//   1. The 3 fixed safety questions are always asked first, verbatim.
//   2. Every user turn is keyword-scanned; danger → 911 line, end call, mark critical + escalate mid-call.
//   3. If Nemotron is slow or returns junk, we speak the next scripted question instead.
import { chatJSON, type Priority } from "../agents/nemotron.js";
import { CORE_QUESTIONS, EMERGENCY_LINE, detectDanger, isConcreteThreat, stripFalsePromises } from "../agents/safety.js";
import type { CallScript } from "../agents/triage.js";
import { CASE_REPLIES, SILENCE_GIVEUP, classify, type CallCase, type CallOutcome } from "./cases.js";
import { ctxEventType, ctxName, logAgent, type Id, type Row } from "../repo.js";

export interface Turn { role: "agent" | "user"; content: string }
export interface BrainReply { say: string; endCall: boolean }

export interface CallSession {
  alertId: Id | null;
  personId: Id | null;
  attemptId: Id | null;
  ctx: Row;
  script: CallScript;
  /** true for mock calls — their Nemotron requests yield to real calls. */
  simulated?: boolean;
}

// attemptId → session, registered by the pipeline right before a call is placed.
const sessions = new Map<string, CallSession>();
export const registerCallSession = (s: CallSession) => sessions.set(String(s.attemptId), s);
export const getCallSession = (attemptId: Id) => sessions.get(String(attemptId));
export const dropCallSession = (attemptId: Id) => sessions.delete(String(attemptId));

// Who actually produced each spoken turn on REAL calls — proof that Nemotron is the brain (shown at /health).
export const liveCallStats = { nemotronTurns: 0, fallbackTurns: 0, lastNemotronAt: null as string | null };
function countTurn(byModel: boolean) {
  if (byModel) { liveCallStats.nemotronTurns++; liveCallStats.lastNemotronAt = new Date().toISOString(); }
  else liveCallStats.fallbackTurns++;
}

const MAX_FOLLOWUPS = 3;
const DANGER_RULE = `Think critically first: write threat_assessment (what is actually happening right now, to whom, and
whether it could kill or seriously injure someone within the next hour — or is it weather, property, past or resolved).
Then set danger=true ONLY if the caller's LAST message describes IMMEDIATE danger to life right now:
trapped, unconscious/unresponsive, not breathing, severe bleeding, collapse, chest pain/stroke, rising water inside,
fire, gas leak, structure collapse, life-support equipment about to fail, or asking for emergency help.
Property damage, outages, or problems already resolved are NOT immediate danger.
NOT danger (danger=false): "lots of water around", "I heard thunder", "the street is flooded", "power is out", "I'm scared",
"water is up to the steps outside". Weather and flooding OUTSIDE the home are not, by themselves, a threat to life.`;
const MAX_TURNS = 14; // hard cap so a call can never run on forever
// "I don't think so", "not sure", "might have to check" — an uncertain answer, not a confirmed no.
const UNSURE = /\b(don'?t think so|not sure|i don'?t know|dunno|might (have to|need to) (go )?check|have to check|need to check|i'?ll check|maybe|possibly|not certain)\b/i;
const NON_ANSWER = /^(hello|hi|hey|yes\?|what|huh|sorry|pardon|who is this|who's this|who is calling|can you repeat( that)?|say that again)[\s?.!,]*$/i;
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
  private turns = 0;
  private distressMentions = 0;
  /** Set when the call ends for a special reason (voicemail, opt-out, silence…); null = normal flow. */
  outcome: CallOutcome | null = null;
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

  /** Caller stayed silent through every reminder. */
  giveUp(): BrainReply {
    this.outcome = "silent";
    return { say: SILENCE_GIVEUP, endCall: true };
  }

  /** True once all fixed safety questions have been asked. */
  get coreDone() { return this.coreIdx >= CORE_QUESTIONS.length; }

  async reply(transcript: Turn[]): Promise<BrainReply> {
    const lastUser = [...transcript].reverse().find((t) => t.role === "user")?.content ?? "";

    // (2) Danger always wins: instant keyword scan first, then Nemotron's danger flag on the same request as the reply.
    const keyword = detectDanger(lastUser);
    if (keyword.danger) return this.emergency(lastUser, keyword.matched);

    // Edge cases (voicemail, opt-out, wrong person…) are answered from code, no model call.
    const kase = classify(lastUser, transcript.filter((t) => t.role === "user").length);
    // Saying "emergency"/"help me" once gets a clarifying question; saying it again means they mean it.
    if (kase === "vague_distress" && ++this.distressMentions >= 2) return this.emergency(lastUser, ["repeated call for help"]);
    let out: BrainReply;
    if (kase) {
      out = this.caseReply(kase);
      this.log(`Call case: ${kase}`, { lastUser });
      if (out.endCall) this.outcome = kase;
    } else {
      const { reply, danger } = await this.normalReply(transcript);
      // The model's flag must name a concrete life threat (its reason or the caller's words) — weather alone never triggers 911.
      if (danger && isConcreteThreat(danger, lastUser)) return this.emergency(lastUser, [`nemotron: ${danger}`]);
      if (danger) this.log(`Nemotron flagged "${danger}" but no concrete life threat was stated — continuing the call`, { lastUser });
      out = reply;
    }
    if (++this.turns > MAX_TURNS && !out.endCall) return { say: this.s.script.closing, endCall: true };
    return out;
  }

  private caseReply(kase: CallCase): BrainReply {
    if (kase === "about_emergency") {
      const event = ctxEventType(this.s.ctx) || "emergency";
      return { say: `I'm calling about the ${event} in your area. I'm just checking that you and everyone in your home are safe. ${this.lastAsked}`, endCall: false };
    }
    if (kase === "vague_distress") this.lastAsked = CASE_REPLIES.vague_distress.say; // a silence reminder should repeat this question
    const { say, ends } = CASE_REPLIES[kase];
    return ends ? { say, endCall: true } : { say: `${say} ${this.lastAsked}`, endCall: false };
  }

  private async emergency(lastUser: string, matched: string[]): Promise<BrainReply> {
    this.outcome = "completed";   // we ended the call on purpose for safety — not a caller hang-up
    if (!this.dangerHandled) {
      this.dangerHandled = true;
      this.log(`DANGER on live call [${matched.join(", ")}] — giving 911 instruction and escalating`, { lastUser });
      await this.onDanger?.(lastUser, matched).catch((e) => console.error("onDanger", e));
    }
    return { say: `${EMERGENCY_LINE} I'm alerting emergency responders to your address right now.`, endCall: true };
  }

  /** Simulated calls skip Nemotron for conversation turns unless SIM_CALLS_USE_NEMOTRON=true (saves API quota). */
  private get useModel(): boolean {
    return !this.s.simulated || process.env.SIM_CALLS_USE_NEMOTRON === "true";
  }

  /** Real calls jump the Nemotron queue; simulated calls wait. */
  private get priority(): Priority {
    return this.s.simulated ? "low" : "high";
  }

  private async normalReply(transcript: Turn[]): Promise<{ reply: BrainReply; danger?: string }> {
    // Greetings / confusion aren't answers — re-introduce and repeat the current question.
    const lastUser = [...transcript].reverse().find((t) => t.role === "user")?.content.trim() ?? "";
    if (NON_ANSWER.test(lastUser) && this.lastAsked) {
      return { reply: { say: `This is the State Farm SafeNet assistant, checking on your safety. ${this.lastAsked}`, endCall: false } };
    }

    // (1) Fixed safety questions, verbatim, with a short Nemotron acknowledgement.
    if (this.coreIdx < CORE_QUESTIONS.length) {
      const answered = CORE_QUESTIONS[this.coreIdx - 1];
      const q = CORE_QUESTIONS[this.coreIdx++];
      const r = await this.ack(transcript);
      this.lastAsked = q;
      if (!this.s.simulated) countTurn(Boolean(r));
      // Unsure whether anyone is hurt → tell them to check now, in code (never left to the model).
      const nudge = answered === CORE_QUESTIONS[1] && UNSURE.test(lastUser)
        ? "Please check on everyone in your home right now. If anyone is hurt, hang up and call 911. "
        : "";
      return { reply: { say: `${nudge || (r?.ack ?? "Thank you.") + " "}${q}`, endCall: false }, danger: r?.danger };
    }

    // Follow-up phase: Nemotron leads, bounded by MAX_FOLLOWUPS.
    if (this.followups < MAX_FOLLOWUPS) {
      const planned = this.s.script.questions.slice(CORE_QUESTIONS.length);
      const llm = !this.useModel ? null : await withTimeout(
        chatJSON(
          `You are the State Farm SafeNet assistant on a LIVE phone call with a policyholder during a disaster.
The fixed safety questions are done. Now ask at most ${MAX_FOLLOWUPS - this.followups} more short follow-up question(s), ONE per turn,
responding naturally to what they just said. Planned follow-ups (use, adapt, or skip): ${JSON.stringify(planned)}.
Rules: under 30 words, warm and calm, never promise that help or responders are coming, no medical/legal/claims advice (say a State Farm agent will follow up on claims).
If you have what responders need, OR the caller says "that's all", "no", "nothing else", "I'm fine", set done=true and say a brief thank-you.
Only ask about things in the caller profile or things they mentioned — never invent pets, family members or equipment.
If the caller doesn't recognize something from their profile ("what's that?", "I don't have one"), accept it and move on — don't insist.
${DANGER_RULE}
JSON: {"threat_assessment": "one sentence: what is happening and is anyone's life at risk in the next hour?", "say": "...", "done": boolean, "danger": boolean, "danger_reason": "max 8 words"}`,
          `Caller profile: ${profileSummary(this.s.ctx)}\n\nCall so far:\n${transcriptText(transcript).slice(-4000)}`,
          (x: any) => (typeof x?.say === "string" && x.say.length > 0 && x.say.length < 400 && typeof x?.done === "boolean" ? x : null),
          this.priority,
        ),
        TURN_TIMEOUT_MS,
      );
      if (!this.s.simulated) countTurn(Boolean(llm));
      if (llm) {
        const danger = llm.danger === true ? String(llm.danger_reason ?? llm.threat_assessment ?? "immediate danger") : undefined;
        if (danger) return { reply: { say: "", endCall: true }, danger };
        llm.say = stripFalsePromises(llm.say);
        this.log(llm.done ? "Nemotron: enough information — wrapping up" : "Nemotron chose next follow-up", { say: llm.say });
        if (llm.done) return { reply: { say: `${llm.say} ${this.s.script.closing}`, endCall: true } };
        this.followups++;
        this.lastAsked = llm.say;
        return { reply: { say: llm.say, endCall: false } };
      }
      // (3) Fallback: next scripted question.
      const next = planned[this.followups++];
      if (next) {
        if (this.useModel) this.log("Nemotron slow/unavailable — using scripted follow-up", { say: next });
        this.lastAsked = next;
        return { reply: { say: `Thank you. ${next}`, endCall: false } };
      }
    }

    return { reply: { say: this.s.script.closing, endCall: true } };
  }

  private ack(transcript: Turn[]): Promise<{ ack: string; danger?: string } | null> {
    if (!this.useModel) return Promise.resolve(null);
    return withTimeout(
      chatJSON(
        `You are on a live disaster check-in call. Write a very short, calm acknowledgement (max 12 words) of what the
caller just said. Do NOT ask a question. Never promise that help is coming. Don't repeat your previous acknowledgement word for word.
${DANGER_RULE}
JSON: {"threat_assessment": "one sentence: what is happening and is anyone's life at risk in the next hour?", "ack": "...", "danger": boolean, "danger_reason": "max 8 words"}`,
        transcriptText(transcript.slice(-4)),
        (x: any) => (typeof x?.ack === "string" && x.ack.length < 120 && !x.ack.includes("?")
          ? { ack: stripFalsePromises(x.ack as string), danger: x.danger === true ? String(x.danger_reason ?? x.threat_assessment ?? "immediate danger") : undefined }
          : null),
        this.priority,
      ),
      ACK_TIMEOUT_MS,
    );
  }

  private log(thought: string, output?: unknown) {
    if (this.s.alertId == null) return console.log(`[voice] ${thought}`);
    void logAgent({ alertId: this.s.alertId, personId: this.s.personId, agent: "triage", tool: "live_call", thought, output });
  }
}
