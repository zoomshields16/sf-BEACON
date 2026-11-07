// Photon (spectrum-ts) text wrapper. Texts go out on the same Photon number as calls.
//
// TODO(real line): wire spectrum-ts here. From the docs:
//   import { Spectrum } from "spectrum-ts";
//   const app = await Spectrum({ projectId, projectSecret, providers: [imessage.config()] });
//   for await (const [space, message] of app.messages) { ... }   // inbound
//   await space.send("text");                                     // outbound
// Inbound messages should be forwarded to handleInboundText(fromPhone, text) in agents/pipeline.ts
// (or POSTed to /webhooks/sms as {"from": "+1...", "text": "..."}).
import { simulateTextReply } from "./mock.js";

export async function sendText(to: string, body: string, opts: { expectReply: boolean; personId?: string | number }): Promise<void> {
  if (process.env.MOCK_CALLS === "true") {
    console.log(`[mock sms → ${to}] ${body}`);
    if (opts.expectReply) simulateTextReply(to, opts.personId);
    return;
  }
  throw new Error("Photon texting not wired yet — see TODO in src/services/photon.ts (or set MOCK_CALLS=true)");
}
