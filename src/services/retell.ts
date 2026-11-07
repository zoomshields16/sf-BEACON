// Retell voice wrapper. Calls go out from the Photon number (SIP-trunked into Retell).
// The Retell agent's prompt must use the dynamic variables below — see docs/retell-agent-prompt.md.
import type { CallScript } from "../agents/triage.js";
import { EMERGENCY_LINE } from "../agents/safety.js";
import type { CallResult } from "../agents/pipeline.js";
import type { Id } from "../repo.js";
import { simulateCall } from "./mock.js";

export interface PlaceCallInput {
  attemptId: Id;
  alertId: Id;
  personId: Id;
  toPhone: string;
  name: string;
  script: CallScript;
}

export async function placeVoiceCall(i: PlaceCallInput): Promise<{ externalId: string }> {
  if (process.env.MOCK_CALLS === "true") return simulateCall(i);

  const { RETELL_API_KEY, RETELL_AGENT_ID, PHOTON_PHONE_NUMBER } = process.env;
  if (!RETELL_API_KEY || !RETELL_AGENT_ID || !PHOTON_PHONE_NUMBER) {
    throw new Error("RETELL_API_KEY, RETELL_AGENT_ID and PHOTON_PHONE_NUMBER are required (or set MOCK_CALLS=true)");
  }
  const res = await fetch("https://api.retellai.com/v2/create-phone-call", {
    method: "POST",
    headers: { Authorization: `Bearer ${RETELL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from_number: PHOTON_PHONE_NUMBER,
      to_number: i.toPhone,
      override_agent_id: RETELL_AGENT_ID,
      metadata: { attempt_id: String(i.attemptId), alert_id: String(i.alertId), person_id: String(i.personId) },
      retell_llm_dynamic_variables: {
        name: i.name,
        opening: i.script.opening,
        questions: i.script.questions.map((q, n) => `${n + 1}. ${q}`).join("\n"),
        closing: i.script.closing,
        emergency_line: EMERGENCY_LINE,
      },
    }),
  });
  if (!res.ok) throw new Error(`Retell create-phone-call ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { call_id: string };
  return { externalId: data.call_id };
}

const NOT_ANSWERED = new Set(["dial_no_answer", "dial_busy", "dial_failed", "voicemail_reached", "invalid_destination"]);

/** Returns a CallResult for `call_ended` events; null for everything else. */
export function parseRetellWebhook(body: any): CallResult | null {
  if (body?.event !== "call_ended" || !body.call) return null;
  const call = body.call;
  const transcript = (call.transcript_object ?? [])
    .filter((t: any) => t?.content)
    .map((t: any) => ({ role: t.role === "user" ? "user" : "agent", content: String(t.content) }));
  const answered = !NOT_ANSWERED.has(call.disconnection_reason) && transcript.some((t: any) => t.role === "user");
  return { attemptId: call.metadata?.attempt_id ?? null, externalId: call.call_id, answered, transcript };
}
