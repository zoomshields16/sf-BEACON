import { Router } from "express";
import { parseRetellWebhook } from "../services/retell.js";
import { handleCallEnded, handleInboundText } from "../agents/pipeline.js";

export const webhooks = Router();

// Retell → set the agent's webhook URL to ${PUBLIC_BASE_URL}/webhooks/retell
// TODO: verify the x-retell-signature header before going live.
webhooks.post("/retell", async (req, res) => {
  res.sendStatus(204); // ack fast; Retell retries slow webhooks
  const result = parseRetellWebhook(req.body);
  if (result) await handleCallEnded(result).catch((e) => console.error("retell webhook", e));
});

// Inbound text. Accepts {from, text}; Photon/spectrum-ts listener (or anything else) can forward here.
webhooks.post("/sms", async (req, res) => {
  const from = req.body?.from ?? req.body?.From;
  const text = req.body?.text ?? req.body?.Body;
  if (!from || !text) return res.status(400).json({ error: "from and text required" });
  res.json((await handleInboundText(String(from), String(text))) ?? { ok: false, error: "unknown sender" });
});
