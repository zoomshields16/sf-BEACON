// The contact lifecycle: reach out → result arrives (LiveKit agent or mock) → triage → escalate → follow up.
import { composeOutreachText, composeReply, extractTriage, generateCallScript } from "./triage.js";
import { maybeEscalate } from "./escalation.js";
import { EMERGENCY_LINE } from "./safety.js";
import { placeVoiceCall } from "../services/livekit.js";
import { registerCallSession } from "../voice/brain.js";
import { sendText } from "../services/photon.js";
import {
  addMessage, ctxHistory, ctxName, ctxPhone, findAttempt, finishAttempt, getTriage, insertAttempt,
  latestAttempt, logAgent, personContext, setAttemptExternalId, updateTriage,
  type Channel, type Id, type Row, type TriageFields,
} from "../repo.js";

const IN_FLIGHT_TIMEOUT_MS = 12 * 60_000; // longer than the 10-min max call
const inFlight = new Map<string, NodeJS.Timeout>();
const key = (alertId: Id, personId: Id) => `${alertId}:${personId}`;

// Inbound texts only carry a phone number; remember who we contacted.
const phoneIndex = new Map<string, { alertId: Id; personId: Id }>();
const normPhone = (p: string) => p.replace(/\D/g, "").slice(-10);

export const isInFlight = (alertId: Id, personId: Id) => inFlight.has(key(alertId, personId));

function clearInFlight(alertId: Id, personId: Id) {
  const k = key(alertId, personId);
  clearTimeout(inFlight.get(k));
  inFlight.delete(k);
}

// Texting is off unless TEXTS_ENABLED=true: every contact is a call (call_queue's "sms" becomes another call).
export const textsEnabled = () => process.env.TEXTS_ENABLED === "true";

export async function contactPerson(alertId: Id, personId: Id, requested: Channel) {
  if (isInFlight(alertId, personId)) return { status: "skipped", detail: "contact already in progress" };
  const channel: Channel = requested === "sms" && !textsEnabled() ? "voice" : requested;

  const ctx = await personContext(personId, alertId);
  const phone = ctxPhone(ctx) ?? (process.env.MOCK_CALLS === "true" ? `+1555${String(personId).padStart(7, "0")}` : undefined);
  if (!phone) {
    await logAgent({ alertId, personId, agent: "coordinator", thought: "No phone number on file — skipping" });
    return { status: "failed", detail: "no phone" };
  }
  phoneIndex.set(normPhone(phone), { alertId, personId });

  const attemptId = await insertAttempt(alertId, personId, channel);
  const k = key(alertId, personId);
  inFlight.set(k, setTimeout(async () => {
    inFlight.delete(k);
    await finishAttempt(attemptId, "timeout").catch(() => {});
    await logAgent({ alertId, personId, agent: "system", thought: `Attempt #${attemptId} timed out with no result` });
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
  transcript: { role: "agent" | "user"; content: string }[];
}

export async function handleCallEnded(r: CallResult) {
  const attempt = await findAttempt(r.attemptId, r.externalId);
  if (!attempt) return console.warn("call result for unknown attempt", r.attemptId ?? r.externalId);
  const { alert_id: alertId, person_id: personId, id: attemptId } = attempt;
  if (["completed", "no_answer"].includes(attempt.status)) return; // duplicate webhook

  clearInFlight(alertId, personId);
  await finishAttempt(attemptId, r.answered ? "completed" : "no_answer");
  if (!r.answered) {
    await logAgent({ alertId, personId, agent: "coordinator", tool: "get_call_result", thought: "No answer — will retry (marked exhausted after 4 attempts)" });
    return;
  }

  for (const line of r.transcript) await addMessage(alertId, personId, attemptId, "voice", line.role, line.content);
  const ctx = await personContext(personId, alertId);
  const transcript = r.transcript.map((l) => `${l.role}: ${l.content}`).join("\n");
  const userText = r.transcript.filter((l) => l.role === "user").map((l) => l.content).join("\n");

  const triage = await applyTriage(alertId, personId, await extractTriage(ctx, transcript, userText, alertId, personId));
  await maybeEscalate(ctx, triage, alertId, personId);

  // Belt-and-braces: a critical call also gets the 911 instruction in writing.
  if (triage.status === "critical" && textsEnabled()) {
    const phone = ctxPhone(ctx);
    const text = `State Farm SafeNet: ${EMERGENCY_LINE.replace("hang up and ", "")} We have flagged your case for emergency responders.`;
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
