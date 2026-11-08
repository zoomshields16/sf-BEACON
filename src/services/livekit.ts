// Outbound calls: LiveKit dials the policyholder through the Photon SIP trunk, and once they answer
// we dispatch the SafeNet agent (src/voice/agent.ts) into the room.
import { AgentDispatchClient, RoomServiceClient, SipClient } from "livekit-server-sdk";
import type { CallScript } from "../agents/triage.js";
import { logAgent, type Id, type Row } from "../repo.js";
import { simulateCall } from "./mock.js";

export interface PlaceCallInput {
  attemptId: Id;
  alertId: Id;
  personId: Id;
  toPhone: string;
  name: string;
  script: CallScript;
  ctx: Row;
}

/** Only numbers in LIVE_CALL_ALLOWLIST (comma-separated; defaults to DEMO_PHONES) ever get a real call; 555 numbers never do. */
export function isLiveDialable(phone: string): boolean {
  const digits = (p: string) => p.replace(/\D/g, "").slice(-10);
  const allow = (process.env.LIVE_CALL_ALLOWLIST || process.env.DEMO_PHONES || "").split(",").map((s) => s.trim()).filter(Boolean).map(digits);
  return allow.includes(digits(phone)) && !/^555/.test(digits(phone).slice(3));
}

export async function placeVoiceCall(i: PlaceCallInput): Promise<{ externalId: string }> {
  // Hybrid demo: real calls to allowlisted team phones, simulated calls (same Nemotron brain) for everyone else.
  if (process.env.MOCK_CALLS === "true" || !isLiveDialable(i.toPhone)) return simulateCall(i);

  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_SIP_TRUNK_ID, PHOTON_PHONE_NUMBER } = process.env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_SIP_TRUNK_ID) {
    throw new Error("LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_SIP_TRUNK_ID required (or set MOCK_CALLS=true)");
  }
  const room = `safenet-call-${i.attemptId}`;
  const agentName = process.env.LIVEKIT_AGENT_NAME ?? "safenet-caller";

  // Dial in the background; the coordinator shouldn't block on ringing.
  void (async () => {
    try {
      // Photon sometimes rejects the first INVITE after the line has been idle (403), then accepts an immediate retry.
      const sip = new SipClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
      for (let attempt = 1; ; attempt++) {
        try {
          await sip.createSipParticipant(
            LIVEKIT_SIP_TRUNK_ID, i.toPhone, room,
            { participantIdentity: `callee-${i.personId}`, fromNumber: PHOTON_PHONE_NUMBER, waitUntilAnswered: true, ringingTimeout: 30, maxCallDuration: 600 },
          );
          break;
        } catch (e) {
          const msg = String((e as Error)?.message ?? e);
          const retryable = /403|forbidden|permission_denied|503|408|timeout/i.test(msg) && !/486|busy|declin|no.?answer|480/i.test(msg);
          if (!retryable || attempt >= 3) throw e;
          await logAgent({ alertId: i.alertId, personId: i.personId, agent: "system", tool: "place_voice_call",
                           thought: `Photon rejected dial attempt ${attempt} (${msg.slice(0, 60)}) — retrying` });
          await new Promise((r) => setTimeout(r, 1500 * attempt));
        }
      }
      await new AgentDispatchClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
        .createDispatch(room, agentName, { metadata: JSON.stringify({ attemptId: String(i.attemptId) }) });
    } catch (err) {
      await logAgent({ alertId: i.alertId, personId: i.personId, agent: "system", tool: "place_voice_call",
                       thought: `Call not connected: ${(err as Error).message}` });
      // If they already picked up but the agent couldn't join, don't leave them on a dead line.
      await new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET).deleteRoom(room).catch(() => {});
      const { handleCallEnded } = await import("../agents/pipeline.js");
      await handleCallEnded({ attemptId: i.attemptId, answered: false, transcript: [] });
    }
  })();

  return { externalId: room };
}
