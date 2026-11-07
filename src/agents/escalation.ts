import { chatJSON } from "./nemotron.js";
import {
  createEscalation, ctxLocation, ctxName, ctxPhone, logAgent, openEscalationFor,
  type Id, type Row, type TriageFields,
} from "../repo.js";

/** Simulated RapidSOS-style payload. Goes in as pending_review — a human confirms before anything is "sent". */
export function buildRapidSosPayload(ctx: Row, triage: TriageFields, reason: string) {
  return {
    provider: "RapidSOS (simulated)",
    source: "State Farm SafeNet",
    created_at: new Date().toISOString(),
    caller: { name: ctxName(ctx), phone: ctxPhone(ctx) ?? null },
    location: ctxLocation(ctx),
    emergency: {
      type: triage.emergency_type ?? "unknown",
      urgency_score: triage.urgency_score,
      location_in_home: triage.location_in_home,
      needs: triage.needs,
      notes: triage.notes,
    },
    reason,
  };
}

/** Welfare-check urgency: base 70, higher for medical needs or age 75+. Capped at 90 so live emergencies still rank above. */
export const welfareUrgency = (p: Row) => Math.min(90, 70 + (p.medical_needs ?? p.medical ? 10 : 0) + (Number(p.age) >= 75 ? 10 : 0));

/** Unreachable after every retry → human-reviewed welfare check (not an automatic 911). */
export async function welfareEscalation(ctx: Row, triage: TriageFields, alertId: Id, personId: Id, attempts: number): Promise<Id | null> {
  const existing = await openEscalationFor(alertId, personId);
  if (existing) return existing.id;
  const reason = `Welfare check: unreachable after ${attempts} call attempts.`;
  const id = await createEscalation(alertId, personId, reason, buildRapidSosPayload(ctx, triage, reason));
  await logAgent({ alertId, personId, agent: "escalation", tool: "escalate_to_911", thought: `${reason} Escalation #${id} pending review` });
  return id;
}

/** critical → always escalate. needs_help with high urgency → Nemotron decides. Returns escalation id or null. */
export async function maybeEscalate(ctx: Row, triage: TriageFields, alertId: Id, personId: Id): Promise<Id | null> {
  if (triage.status !== "critical" && !(triage.status === "needs_help" && triage.urgency_score >= 70)) return null;

  const existing = await openEscalationFor(alertId, personId);
  if (existing) {
    await logAgent({ alertId, personId, agent: "escalation", thought: "Escalation already pending review; not duplicating" });
    return existing.id;
  }

  let reason = `Triage marked ${triage.status} (urgency ${triage.urgency_score}).`;
  if (triage.status !== "critical") {
    const decision = await chatJSON(
      `You decide whether a disaster case should be escalated to 911 dispatch. Escalate only for risk to life or
severe medical need. JSON: {"escalate": boolean, "reason": "one sentence"}`,
      JSON.stringify({ triage, profile: ctx.profile ?? null }).slice(0, 3000),
      (x: any) => (typeof x?.escalate === "boolean" && typeof x?.reason === "string" ? x : null),
    );
    await logAgent({
      alertId, personId, agent: "escalation", tool: "decide_escalation",
      thought: decision ? `Nemotron: ${decision.escalate ? "escalate" : "do not escalate"} — ${decision.reason}` : "No model decision; holding for responder",
      output: decision,
    });
    if (!decision?.escalate) return null;
    reason = decision.reason;
  }

  const payload = buildRapidSosPayload(ctx, triage, reason);
  const id = await createEscalation(alertId, personId, reason, payload);
  await logAgent({
    alertId, personId, agent: "escalation", tool: "escalate_to_911",
    thought: `Created 911 escalation #${id} (pending human review)`, output: payload,
  });
  return id;
}
