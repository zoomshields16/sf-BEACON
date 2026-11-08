// Creates (or reuses) the LiveKit outbound SIP trunk pointing at Photon, and writes LIVEKIT_SIP_TRUNK_ID to .env.
// Usage: npx tsx scripts/setup-livekit-trunk.ts
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { SipClient } from "livekit-server-sdk";
import { SIPTransport, SIPMediaEncryption } from "@livekit/protocol";

const need = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "PHOTON_SIP_HOST", "PHOTON_SIP_PORT",
              "PHOTON_SIP_USERNAME", "PHOTON_SIP_PASSWORD", "PHOTON_PHONE_NUMBER"];
const missing = need.filter((k) => !process.env[k]);
if (missing.length) throw new Error(`missing env: ${missing.join(", ")}`);

const NAME = "photon-outbound";
const sip = new SipClient(process.env.LIVEKIT_URL!, process.env.LIVEKIT_API_KEY!, process.env.LIVEKIT_API_SECRET!);
const address = `${process.env.PHOTON_SIP_HOST}:${process.env.PHOTON_SIP_PORT}`;

const existing = (await sip.listSipOutboundTrunk()).find((t) => t.name === NAME);
const trunk = existing ?? await sip.createSipOutboundTrunk(NAME, address, [process.env.PHOTON_PHONE_NUMBER!], {
  transport: SIPTransport.SIP_TRANSPORT_TLS,
  authUsername: process.env.PHOTON_SIP_USERNAME,
  authPassword: process.env.PHOTON_SIP_PASSWORD,
  mediaEncryption: SIPMediaEncryption.SIP_MEDIA_ENCRYPT_ALLOW,
});
console.log(`${existing ? "Reusing" : "Created"} trunk ${trunk.sipTrunkId} → ${trunk.address} numbers=${trunk.numbers.join(",")}`);

const env = readFileSync(".env", "utf8");
writeFileSync(".env", /^LIVEKIT_SIP_TRUNK_ID=.*$/m.test(env)
  ? env.replace(/^LIVEKIT_SIP_TRUNK_ID=.*$/m, `LIVEKIT_SIP_TRUNK_ID=${trunk.sipTrunkId}`)
  : `${env}\nLIVEKIT_SIP_TRUNK_ID=${trunk.sipTrunkId}\n`);
console.log("Wrote LIVEKIT_SIP_TRUNK_ID to .env");
