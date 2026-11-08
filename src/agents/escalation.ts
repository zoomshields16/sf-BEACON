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

/** State Farm responder follow-up (not 911): medication, power, transport, welfare checks. */
export function buildAssistPayload(ctx: Row, triage: TriageFields, reason: string) {
  return { ...buildRapidSosPayload(ctx, triage, reason), provider: "State Farm responder queue (not 911)" };
}

/** Welfare-check urgency: base 70, higher for medical needs or age 75+. Capped at 90 so live emergencies still rank above. */
export const welfareUrgency = (p: Row) => Math.min(90, 70 + (p.medical_needs ?? p.medical ? 10 : 0) + (Number(p.age) >= 75 ? 10 : 0));

/** Unreachable after every retry → welfare check for a State Farm responder (NOT 911). */
export async function welfareEscalation(ctx: Row, triage: TriageFields, alertId: Id, personId: Id, attempts: number): Promise<Id | null> {
  const existing = await openEscalationFor(alertId, personId, "welfare");
  if (existing) return existing.id;
  const reason = `Welfare check: unreachable after ${attempts} call attempts.`;
  const id = await createEscalation(alertId, personId, reason, buildAssistPayload(ctx, triage, reason), "welfare");
  await logAgent({ alertId, personId, agent: "escalation", tool: "request_assistance", thought: `${reason} Queued for a State Farm responder (#${id}) — not a 911 call` });
  return id;
}

/**
 * 911 is for life-or-death ONLY: triage must be critical (danger heard on the call, or Nemotron's life-threat flag).
 * High-urgency needs (medication, power for medical equipment, transport) go to the State Farm responder queue —
 * Nemotron decides whether it's urgent today and writes the handoff reason.
 */
export async function maybeEscalate(ctx: Row, triage: TriageFields, alertId: Id, personId: Id): Promise<Id | null> {
  if (triage.status === "critical") {
    const existing = await openEscalationFor(alertId, personId, "911");
    if (existing) {
      await logAgent({ alertId, personId, agent: "escalation", thought: "911 escalation already pending review; not duplicating" });
      return existing.id;
    }
    const reason = `Life-threatening: ${triage.emergency_type ?? "immediate danger"} (urgency ${triage.urgency_score}).`;
    const payload = buildRapidSosPayload(ctx, triage, reason);
    const id = await createEscalation(alertId, personId, reason, payload, "911");
    await logAgent({ alertId, personId, agent: "escalation", tool: "escalate_to_911",
                     thought: `Created 911 escalation #${id} (pending human review)`, output: payload });
    return id;
  }

  if (triage.status !== "needs_help" || triage.urgency_score < 60) return null;
  if (await openEscalationFor(alertId, personId, "urgent_assist")) return null;

  const decision = await chatJSON(
    `You route disaster cases for State Farm. This person is NOT in immediate danger (that would already be a 911 case).
Decide if they need a State Farm responder to follow up urgently TODAY (medication that must stay cold, power for
medical equipment, can't evacuate, no safe place to stay) versus routine follow-up. Never send this to 911.
JSON: {"urgent": boolean, "reason": "one short sentence for the responder"}`,
    JSON.stringify({ triage, profile: ctx.profile ?? null }).slice(0, 3000),
    (x: any) => (typeof x?.urgent === "boolean" && typeof x?.reason === "string" ? x : null),
  );
  const urgent = decision ? decision.urgent : triage.urgency_score >= 70;   // no model → urgency threshold
  const reason = decision?.reason ?? `Needs help (urgency ${triage.urgency_score}): ${triage.needs.join(", ") || "follow-up"}`;
  await logAgent({
    alertId, personId, agent: "escalation", tool: "decide_assistance",
    thought: `${decision ? "Nemotron" : "Rule"}: ${urgent ? "urgent responder follow-up" : "routine follow-up"} — ${reason}`,
    output: decision,
  });
  if (!urgent) return null;
  const id = await createEscalation(alertId, personId, reason, buildAssistPayload(ctx, triage, reason), "urgent_assist");
  await logAgent({ alertId, personId, agent: "escalation", tool: "request_assistance",
                   thought: `Queued urgent assistance #${id} for a State Farm responder (not 911)` });
  return id;
}
