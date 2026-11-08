// Tools exposed to Nemotron via function calling. alert_id is injected from context, never chosen by the model.
import type { ToolDef } from "./nemotron.js";
import { contactPerson } from "./pipeline.js";
import { generateCallScript } from "./triage.js";
import { buildRapidSosPayload } from "./escalation.js";
import {
  callQueue, createEscalation, getTriage, hexRisk, latestAttempt, openEscalationFor, personContext, updateTriage,
  type TriageFields,
} from "../repo.js";

const personParam = {
  type: "object",
  properties: { person_id: { type: ["string", "integer"], description: "Policyholder id from the call queue" } },
  required: ["person_id"],
};

export const TOOLS: Record<string, ToolDef> = {
  get_call_queue: {
    name: "get_call_queue",
    description: "Next policyholders to contact for this alert, highest priority first. Includes next_channel (voice or sms).",
    parameters: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: 25 } } },
    run: async ({ limit = 10 }, { alertId }) => callQueue(alertId, Math.min(Number(limit) || 10, 25)),
  },
  get_person_context: {
    name: "get_person_context",
    description: "Full profile, SafeRoom, triage status and call/text history for one policyholder.",
    parameters: personParam,
    run: ({ person_id }, { alertId }) => personContext(person_id, alertId),
  },
  get_hex_risk: {
    name: "get_hex_risk",
    description: "Crowdsourced risk per map hexagon for this alert. Use it to prioritize people in high-risk areas.",
    parameters: { type: "object", properties: {} },
    run: async (_a, { alertId }) => (await hexRisk(alertId)).slice(0, 30),
  },
  generate_call_script: {
    name: "generate_call_script",
    description: "Builds the call script: 3 fixed safety questions plus personalized follow-ups.",
    parameters: personParam,
    run: async ({ person_id }, { alertId }) =>
      generateCallScript(await personContext(person_id, alertId), alertId, person_id),
  },
  place_voice_call: {
    name: "place_voice_call",
    description: "Start an AI voice check-in call. The result arrives asynchronously; check it with get_call_result.",
    parameters: personParam,
    run: ({ person_id }, { alertId }) => contactPerson(alertId, person_id, "voice"),
  },
  send_text: {
    name: "send_text",
    description: "Send a check-in text. It automatically references anything the person said on a previous call.",
    parameters: personParam,
    run: ({ person_id }, { alertId }) => contactPerson(alertId, person_id, "sms"),
  },
  get_call_result: {
    name: "get_call_result",
    description: "Latest contact attempt status and current triage for a policyholder.",
    parameters: personParam,
    run: async ({ person_id }, { alertId }) => ({
      attempt: await latestAttempt(alertId, person_id),
      triage: await getTriage(alertId, person_id),
    }),
  },
  update_triage: {
    name: "update_triage",
    description: "Manually set triage for a policyholder. Cannot downgrade a critical case.",
    parameters: {
      type: "object",
      properties: {
        person_id: { type: ["string", "integer"] },
        status: { type: "string", enum: ["safe", "needs_help", "critical"] },
        urgency_score: { type: "integer", minimum: 0, maximum: 100 },
        emergency_type: { type: "string" },
        needs: { type: "array", items: { type: "string" } },
        location_in_home: { type: "string" },
        notes: { type: "string" },
      },
      required: ["person_id", "status", "urgency_score"],
    },
    run: async (a, { alertId }) => {
      const current = await getTriage(alertId, a.person_id);
      if (current?.status === "critical" && a.status !== "critical") return { error: "cannot downgrade a critical case" };
      const t: TriageFields = {
        status: a.status, urgency_score: Number(a.urgency_score), emergency_type: a.emergency_type ?? null,
        needs: a.needs ?? [], location_in_home: a.location_in_home ?? null, notes: a.notes ?? "",
      };
      await updateTriage(alertId, a.person_id, t);
      return { ok: true };
    },
  },
  escalate_to_911: {
    name: "escalate_to_911",
    description: "Simulated RapidSOS 911 escalation (pending human review). ONLY for life-or-death cases whose triage is critical; anything else is refused.",
    parameters: {
      type: "object",
      properties: { person_id: { type: ["string", "integer"] }, reason: { type: "string" } },
      required: ["person_id", "reason"],
    },
    run: async ({ person_id, reason }, { alertId }) => {
      const triage = (await getTriage(alertId, person_id)) as TriageFields;
      if (triage?.status !== "critical") {
        return { error: `911 is reserved for life-or-death cases. This person's triage is '${triage?.status ?? "unknown"}', so they are handled by the State Farm responder queue instead.` };
      }
      const existing = await openEscalationFor(alertId, person_id, "911");
      if (existing) return { ok: true, escalation_id: existing.id, note: "already pending" };
      const ctx = await personContext(person_id, alertId);
      const id = await createEscalation(alertId, person_id, reason, buildRapidSosPayload(ctx, triage, reason));
      return { ok: true, escalation_id: id };
    },
  },
};

export const COORDINATOR_TOOLS = [
  "get_call_queue", "get_hex_risk", "get_person_context", "place_voice_call", "get_call_result", "escalate_to_911",
  ...(process.env.TEXTS_ENABLED === "true" ? ["send_text"] : []),
].map((n) => TOOLS[n]);
