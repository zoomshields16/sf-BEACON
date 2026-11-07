// Places a real test call without the DB: dials <phone> from the Photon number, then dispatches the agent.
// The agent runs its built-in test script (3 safety questions + 1 follow-up), still driven by Nemotron.
// Usage: npx tsx scripts/test-call.ts +15551234567     (agent must be running: npm run agent)
import "dotenv/config";
import { AgentDispatchClient, SipClient } from "livekit-server-sdk";

const to = process.argv[2];
if (!to?.startsWith("+")) throw new Error("usage: npx tsx scripts/test-call.ts +1XXXXXXXXXX");
if (to.replace(/\D/g, "") === (process.env.PHOTON_PHONE_NUMBER ?? "").replace(/\D/g, "")) throw new Error("can't call the Photon number itself");

const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_SIP_TRUNK_ID, PHOTON_PHONE_NUMBER } = process.env;
const room = `safenet-test-${Date.now()}`;
console.log(`Dialing ${to} from ${PHOTON_PHONE_NUMBER} (room ${room})… answer your phone`);
const t = Date.now();
const p = await new SipClient(LIVEKIT_URL!, LIVEKIT_API_KEY!, LIVEKIT_API_SECRET!).createSipParticipant(
  LIVEKIT_SIP_TRUNK_ID!, to, room,
  { participantIdentity: "test-callee", fromNumber: PHOTON_PHONE_NUMBER, waitUntilAnswered: true, ringingTimeout: 30, maxCallDuration: 300 },
);
console.log(`Answered after ${((Date.now() - t) / 1000).toFixed(1)}s (participant ${p.participantId}). Dispatching agent…`);
await new AgentDispatchClient(LIVEKIT_URL!, LIVEKIT_API_KEY!, LIVEKIT_API_SECRET!)
  .createDispatch(room, process.env.LIVEKIT_AGENT_NAME ?? "safenet-caller", { metadata: "{}" });
console.log("Agent dispatched — it should greet you in a second or two.");
