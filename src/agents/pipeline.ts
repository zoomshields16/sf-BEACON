// The contact lifecycle: reach out → result arrives (LiveKit agent or mock) → triage → escalate → follow up.
import { composeOutreachText, composeReply, extractTriage, generateCallScript } from "./triage.js";
import { buildAssistPayload, maybeEscalate, welfareEscalation, welfareUrgency } from "./escalation.js";
import { EMERGENCY_LINE } from "./safety.js";
import { placeVoiceCall } from "../services/livekit.js";
import { registerCallSession } from "../voice/brain.js";
import type { CallOutcome } from "../voice/cases.js";
import { sendText } from "../services/photon.js";
import {
  addMessage, countUnreached, createEscalation, openEscalationFor, ctxHistory, ctxName, ctxPhone, findAttempt, finishAttempt, getTriage, insertAttempt,
  latestAttempt, logAgent, setDoNotContact, personContext, setAttemptExternalId, updateTriage,
  type Channel, type Id, type Row, type TriageFields,
} from "../repo.js";

const IN_FLIGHT_TIMEOUT_MS = 12 * 60_000; // longer than the 10-min max call
const inFlight = new Map<string, NodeJS.Timeout>();
const key = (alertId: Id, personId: Id) => `${alertId}:${personId}`;

// Inbound texts only carry a phone number; remember who we contacted.
const phoneIndex = new Map<string, { alertId: Id; personId: Id }>();
const normPhone = (p: string) => p.replace(/\D/g, "").slice(-10);


// Outcomes where we didn't actually reach the person → logged as no_answer so the queue retries.
const NOT_REACHED: CallOutcome[] = ["voicemail", "wrong_person", "no_answer"];
const OUTCOME_NOTE: Partial<Record<CallOutcome, string>> = {
  voicemail: "Reached voicemail — hung up without leaving a message, will retry",
  silent: "Caller picked up but did not respond — treated as a possible emergency, escalated for responder review",
  wrong_person: "Wrong person / wrong number — verify the phone on file",
  callback: "Asked to be called back later — responsive but did not verify safety; not retried",
  opt_out: "Asked us to stop calling — contact stopped (flag for a human; do not retry)",
  language: "Caller doesn't speak English — flagged needs_help for an interpreter follow-up",
  hangup: "Caller hung up before the safety questions were finished",
};

const maxAttempts = () => Number(process.env.MAX_CALL_ATTEMPTS ?? 4); // match call_queue's retry limit

/** Out of retries and still no contact → rank high and queue a welfare check for a human. */
async function welfareIfExhausted(alertId: Id, personId: Id) {
  const n = await countUnreached(alertId, personId);
  if (n < maxAttempts()) return;
  const current = await getTriage(alertId, personId);
  // The DB trigger may already have flipped them to 'exhausted' when this attempt was closed — that still qualifies.
  if (current && !["unreached", "exhausted"].includes(current.status)) return; // reached some other way
  const ctx = await personContext(personId, alertId);
  // Stay 'exhausted' (dashboard: "Couldn't reach") but with urgency + a pending welfare-check escalation.
  const t = await applyTriage(alertId, personId, {
    status: "exhausted", urgency_score: welfareUrgency(ctx.profile ?? ctx.person ?? {}), emergency_type: "unreachable",
    needs: ["welfare check"], location_in_home: null, notes: `Unreachable after ${n} call attempts; welfare check requested`,
  });
  await welfareEscalation(ctx, t, alertId, personId, n);
}

export const isInFlight = (alertId: Id, personId: Id) => inFlight.has(key(alertId, personId));

/** Demo reset: forget in-flight calls and phone lookups for this alert (the DB rows are already gone). */
export function forgetAlert(alertId: Id) {
  const prefix = `${alertId}:`;
  for (const [k, t] of inFlight) if (k.startsWith(prefix)) { clearTimeout(t); inFlight.delete(k); }
  for (const [phone, ref] of phoneIndex) if (String(ref.alertId) === String(alertId)) phoneIndex.delete(phone);
}

function clearInFlight(alertId: Id, personId: Id) {
  const k = key(alertId, personId);
  clearTimeout(inFlight.get(k));
  inFlight.delete(k);
}

// Texting is off unless TEXTS_ENABLED=true: every contact is a call (call_queue's "sms" becomes another call).
export const textsEnabled = () => process.env.TEXTS_ENABLED === "true";

export async function contactPerson(alertId: Id, personId: Id, requested: Channel) {
  if (isInFlight(alertId, personId)) return { status: "skipped", detail: "contact already in progress" };
  // Reserve the slot BEFORE any await, so a dashboard "Call now" and a coordinator round can't both dial this person.
  const k = key(alertId, personId);
  inFlight.set(k, setTimeout(() => inFlight.delete(k), IN_FLIGHT_TIMEOUT_MS));
  const release = () => clearInFlight(alertId, personId);

  if ((await getTriage(alertId, personId))?.do_not_contact) { release(); return { status: "skipped", detail: "person asked us to stop calling" }; }
  const channel: Channel = requested === "sms" && !textsEnabled() ? "voice" : requested;

  const ctx = await personContext(personId, alertId);
  const phone = ctxPhone(ctx) ?? (process.env.MOCK_CALLS === "true" ? `+1555${String(personId).padStart(7, "0")}` : undefined);
  if (!phone) {
    release();
    await logAgent({ alertId, personId, agent: "coordinator", thought: "No phone number on file — skipping" });
    return { status: "failed", detail: "no phone" };
  }
  phoneIndex.set(normPhone(phone), { alertId, personId });

  const attemptId = await insertAttempt(alertId, personId, channel);
  clearTimeout(inFlight.get(k));
  inFlight.set(k, setTimeout(async () => {
    inFlight.delete(k);
    await finishAttempt(attemptId, "timeout").catch(() => {});
    await logAgent({ alertId, personId, agent: "system", thought: `Attempt #${attemptId} timed out with no result` });
    await welfareIfExhausted(alertId, personId).catch(() => {});   // last retry timing out still triggers the welfare check
  }, IN_FLIGHT_TIMEOUT_MS));

  try {
    if (channel === "voice") {
      const script = await generateCallScript(ctx, alertId, personId);
      registerCallSession({ alertId, personId, attemptId, ctx, script });
      const { externalId } = await placeVoiceCall({ attemptId, alertId, personId, toPhone: phone, name: ctxName(ctx), script, ctx });
      await setAttemptExternalId(attemptId, externalId);
      await logAgent({ alertId, personId, agent: "coordinator", tool: "place_voice_call", thought: `Calling ${ctxName(ctx)}`, output: { attemptId, externalId } });
    } else {
      const text = await composeOutreachText(ctx, alertId, personId);
      await addMessage(alertId, personId, attemptId, "sms", "agent", text);
      await sendText(phone, text, { expectReply: true, personId });
      await finishAttempt(attemptId, "sent");
      await logAgent({ alertId, personId, agent: "coordinator", tool: "send_text", thought: `Texted ${ctxName(ctx)}`, output: { attemptId, text } });
    }
    return { status: "started", attemptId };
  } catch (err) {
    clearInFlight(alertId, personId);
    await finishAttempt(attemptId, "failed");
    await logAgent({ alertId, personId, agent: "system", thought: `${channel} attempt failed: ${(err as Error).message}` });
    await welfareIfExhausted(alertId, personId).catch(() => {});   // a failed final attempt still triggers the welfare check
    return { status: "failed", attemptId, detail: (err as Error).message };
  }
}

/** Writes triage, but never auto-downgrades a critical case — a human clears those. */
async function applyTriage(alertId: Id, personId: Id, t: TriageFields) {
  const current = await getTriage(alertId, personId);
  if (current?.status === "critical" && t.status !== "critical") {
    t = { ...t, status: "critical", urgency_score: Math.max(t.urgency_score, Number(current.urgency_score) || 90),
          notes: `${t.notes} [held at critical pending responder review]` };
  }
  await updateTriage(alertId, personId, t);
  return t;
}

/** Called the moment danger is heard on a live call — escalate before the call even ends. */
/** A model disagreement on a live call → urgent-assistance request so a human verifies. Never a 911 escalation. */
export async function flagForReview(alertId: Id, personId: Id, userText: string, reason: string) {
  if (await openEscalationFor(alertId, personId, "urgent_assist")) return;
  const ctx = await personContext(personId, alertId);
  const triage = (await getTriage(alertId, personId)) ?? { status: "unreached", urgency_score: 0, emergency_type: null, needs: [], location_in_home: null, notes: "" };
  const id = await createEscalation(alertId, personId, reason, buildAssistPayload(ctx, triage as TriageFields, reason), "urgent_assist");
  await logAgent({ alertId, personId, agent: "escalation", tool: "request_assistance", thought: `Human review requested (#${id}): ${reason}` });
}

export async function markCriticalNow(alertId: Id, personId: Id, userText: string, matched: string[]) {
  const ctx = await personContext(personId, alertId);
  const t = await applyTriage(alertId, personId, {
    status: "critical", urgency_score: 95, emergency_type: matched.join(", ") || "unknown",
    needs: ["emergency response"], location_in_home: null, notes: `Live call: "${userText.slice(0, 300)}"`,
  });
  await logAgent({ alertId, personId, agent: "triage", tool: "update_triage", thought: "Live-call danger → critical", output: t });
  await maybeEscalate(ctx, t, alertId, personId);
}

export interface CallResult {
  attemptId?: Id | null;
  externalId?: string | null;
  answered: boolean;
  outcome?: CallOutcome; // how the call ended; missing = old behavior (answered ? completed : no_answer)
  transcript: { role: "agent" | "user"; content: string }[];
}

export async function handleCallEnded(r: CallResult) {
  const attempt = await findAttempt(r.attemptId, r.externalId);
  if (!attempt) return console.warn("call result for unknown attempt", r.attemptId ?? r.externalId);
  const { alert_id: alertId, person_id: personId, id: attemptId } = attempt;
  if (["completed", "no_answer"].includes(attempt.status)) return; // duplicate webhook

  clearInFlight(alertId, personId);
  const outcome: CallOutcome = r.outcome ?? (r.answered ? "completed" : "no_answer");
  const reached = outcome === "silent" || (r.answered && !NOT_REACHED.includes(outcome));
  await finishAttempt(attemptId, reached ? "completed" : "no_answer");
  const note = OUTCOME_NOTE[outcome] ?? (!r.answered ? "No answer — will retry (marked exhausted after 4 attempts)" : null);
  if (note) await logAgent({ alertId, personId, agent: "coordinator", tool: "get_call_result", thought: note, output: { outcome } });
  if (outcome === "opt_out") await setDoNotContact(alertId, personId);
  if (outcome === "silent") {
    // Unresponsive on a live line is the strongest "not okay" signal we get. Escalation is pending_review, so a human confirms.
    await markCriticalNow(alertId, personId, "Line answered but the caller stopped responding", ["unresponsive"]);
    return;
  }
  if (!reached && outcome !== "opt_out") await welfareIfExhausted(alertId, personId);
  if (!reached || outcome === "opt_out") return;
  if (outcome === "callback") {
    await applyTriage(alertId, personId, {
      status: "needs_help", urgency_score: 30, emergency_type: "unverified", needs: [],
      location_in_home: null, notes: "Answered and spoke but asked to be called back later; safety not verified",
    });
    return;
  }
  if (outcome === "language") {
    await applyTriage(alertId, personId, {
      status: "needs_help", urgency_score: 60, emergency_type: "language_barrier", needs: ["interpreter"],
      location_in_home: null, notes: "Caller does not speak English; needs a translator follow-up",
    });
    return;
  }

  for (const line of r.transcript) await addMessage(alertId, personId, attemptId, "voice", line.role, line.content);
  const ctx = await personContext(personId, alertId);
  const transcript = r.transcript.map((l) => `${l.role}: ${l.content}`).join("\n");
  const userText = r.transcript.filter((l) => l.role === "user").map((l) => l.content).join("\n");

  let extracted = await extractTriage(ctx, transcript, userText, alertId, personId);
  // Hung up before all 3 safety questions were answered → we can't call them "safe". Keep them on a responder's list.
  if (outcome === "hangup" && extracted.status === "safe") {
    extracted = { ...extracted, status: "needs_help", urgency_score: Math.max(extracted.urgency_score, 40), emergency_type: "unverified",
                  notes: `Hung up before the safety questions were finished; safety not verified. ${extracted.notes}`.trim() };
  }
  const triage = await applyTriage(alertId, personId, extracted);
  await maybeEscalate(ctx, triage, alertId, personId);

  // Belt-and-braces: a critical call also gets the 911 instruction in writing.
  if (triage.status === "critical" && textsEnabled()) {
    const phone = ctxPhone(ctx);
    const text = `State Farm BEACON: ${EMERGENCY_LINE.replace("hang up and ", "")} We have flagged your case for emergency responders.`;
    if (phone) {
      await addMessage(alertId, personId, attemptId, "sms", "agent", text);
      await sendText(phone, text, { expectReply: false }).catch((e) => console.error(e));
    }
  }
}

export async function handleInboundText(fromPhone: string, text: string) {
  const ref = phoneIndex.get(normPhone(fromPhone));
  if (!ref) {
    console.warn(`inbound text from unknown number ${fromPhone}`);
    return null;
  }
  const { alertId, personId } = ref;
  clearInFlight(alertId, personId);
  const attempt = await latestAttempt(alertId, personId);
  if (attempt?.status === "sent") await finishAttempt(attempt.id, "replied");

  await addMessage(alertId, personId, attempt?.id ?? null, "sms", "user", text);
  const ctx = await personContext(personId, alertId);
  const transcript = ctxHistory(ctx)
    .map((m: Row) => `${m.channel ?? ""} ${m.role ?? m.speaker}: ${m.content ?? m.text}`)
    .join("\n");

  const triage = await applyTriage(alertId, personId, await extractTriage(ctx, transcript, text, alertId, personId));
  await maybeEscalate(ctx, triage, alertId, personId);

  const reply = await composeReply(ctx, triage);
  await addMessage(alertId, personId, attempt?.id ?? null, "sms", "agent", reply);
  await sendText(fromPhone, reply, { expectReply: false });
  return { alertId, personId, triage, reply };
}
