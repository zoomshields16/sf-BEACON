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
 * Strict "urgent today?" call. Urgent ONLY if something life-sustaining runs out within ~12 hours, or a vulnerable
 * person cannot stay safely at home tonight. Everything else is routine follow-up (still on the "needs help" list).
 */
export async function decideAssistance(ctx: Row, triage: TriageFields): Promise<{ urgent: boolean; reason: string; hours: number | null } | null> {
  return chatJSON(
    `You route disaster cases for State Farm. This person is NOT in immediate danger (that would already be 911).
Be strict and skeptical: responders are scarce, so mark urgent ONLY if one of these is true based on what the caller said:
  1. Life-sustaining medication or medical equipment (oxygen, dialysis, ventilator, powered medical device) will run out
     or fail within about 12 hours.
  2. The home is unsafe tonight AND the person can't leave on their own (mobility, no transport, flooded roads) AND has
     no safe place to go.
  3. A child, elderly or disabled person has no heat/cooling in dangerous temperatures tonight.
NOT urgent (routine follow-up): power out but okay, supplies for a day or more, insulin without ice (room-temperature
insulin lasts weeks), property damage, anxiety, wants information, needs a ride "later" or "if roads clear".
Estimate hours_until_harm (null if no concrete deadline). urgent must be false if hours_until_harm is null or > 12.
Examples:
  "power out, out of ice for my insulin, otherwise okay" → {"urgent": false, "hours_until_harm": null, "reason": "Insulin is stable at room temperature for weeks; routine check on power."}
  "insulin needs to stay cold, 87, wheelchair, power out" → {"urgent": false, "hours_until_harm": null, "reason": "Insulin is fine unrefrigerated; mobility needs a routine follow-up."}
  "oxygen machine battery has about 3 hours left, power is out" → {"urgent": true, "hours_until_harm": 3, "reason": "Oxygen battery runs out in ~3 h; needs power or relocation."}
  "heat is out, 15 degrees tonight, we're both in our 80s" → {"urgent": true, "hours_until_harm": 10, "reason": "Elderly couple without heat in freezing temperatures tonight."}
  "might need a ride later if the roads clear" → {"urgent": false, "hours_until_harm": null, "reason": "Transport request with no deadline."}
JSON: {"urgent": boolean, "hours_until_harm": number|null, "reason": "one short sentence for the responder"}`,
    JSON.stringify({ triage, profile: ctx.profile ?? null, saferoom: ctx.saferoom ?? null }).slice(0, 3000),
    (x: any) => {
      if (typeof x?.urgent !== "boolean" || typeof x?.reason !== "string") return null;
      const hours = typeof x.hours_until_harm === "number" ? x.hours_until_harm : null;
      // Enforce the rule in code too: no concrete deadline within 12 h → not urgent.
      return { urgent: x.urgent && hours !== null && hours <= 12, reason: x.reason, hours };
    },
  );
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

  // Let Nemotron judge every "needs help within a day or two" case (45+); its 12-hour rule decides what's urgent.
  if (triage.status !== "needs_help" || triage.urgency_score < 45) return null;
  if (await openEscalationFor(alertId, personId, "urgent_assist")) return null;

  const decision = await decideAssistance(ctx, triage);
  const urgent = decision ? decision.urgent : triage.urgency_score >= 80;   // no model → only clearly time-critical
  const reason = decision?.reason ?? `Needs help (urgency ${triage.urgency_score}): ${triage.needs.join(", ") || "follow-up"}`;
  await logAgent({
    alertId, personId, agent: "escalation", tool: "decide_assistance",
    thought: `${decision ? "Nemotron" : "Rule"}: ${urgent ? `URGENT (harm in ~${decision?.hours ?? "?"} h)` : "routine follow-up"} — ${reason}`,
    output: decision,
  });
  if (!urgent) return null;
  const id = await createEscalation(alertId, personId, reason, buildAssistPayload(ctx, triage, reason), "urgent_assist");
  await logAgent({ alertId, personId, agent: "escalation", tool: "request_assistance",
                   thought: `Queued urgent assistance #${id} for a State Farm responder (not 911)` });
  return id;
}
