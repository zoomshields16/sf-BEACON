// Outbound calls: LiveKit dials the policyholder through the Photon SIP trunk, and once they answer
// we dispatch the SafeNet agent (src/voice/agent.ts) into the room.
import { AgentDispatchClient, SipClient } from "livekit-server-sdk";
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

export async function placeVoiceCall(i: PlaceCallInput): Promise<{ externalId: string }> {
  if (process.env.MOCK_CALLS === "true") return simulateCall(i);

  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_SIP_TRUNK_ID, PHOTON_PHONE_NUMBER } = process.env;
  if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_SIP_TRUNK_ID) {
    throw new Error("LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_SIP_TRUNK_ID required (or set MOCK_CALLS=true)");
  }
  const room = `safenet-call-${i.attemptId}`;
  const agentName = process.env.LIVEKIT_AGENT_NAME ?? "safenet-caller";

  // Dial in the background; the coordinator shouldn't block on ringing.
  void (async () => {
    try {
      await new SipClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET).createSipParticipant(
        LIVEKIT_SIP_TRUNK_ID, i.toPhone, room,
        { participantIdentity: `callee-${i.personId}`, fromNumber: PHOTON_PHONE_NUMBER, waitUntilAnswered: true, ringingTimeout: 30, maxCallDuration: 600 },
      );
      await new AgentDispatchClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
        .createDispatch(room, agentName, { metadata: JSON.stringify({ attemptId: String(i.attemptId) }) });
    } catch (err) {
      await logAgent({ alertId: i.alertId, personId: i.personId, agent: "system", tool: "place_voice_call",
                       thought: `Call not connected: ${(err as Error).message}` });
      const { handleCallEnded } = await import("../agents/pipeline.js");
      await handleCallEnded({ attemptId: i.attemptId, answered: false, transcript: [] });
    }
  })();

  return { externalId: room };
}
