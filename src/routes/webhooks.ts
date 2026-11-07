import { Router } from "express";
import { handleInboundText } from "../agents/pipeline.js";

export const webhooks = Router();

// Inbound text. Accepts {from, text}; Photon/spectrum-ts listener (or anything else) can forward here.
webhooks.post("/sms", async (req, res) => {
  const from = req.body?.from ?? req.body?.From;
  const text = req.body?.text ?? req.body?.Body;
  if (!from || !text) return res.status(400).json({ error: "from and text required" });
  res.json((await handleInboundText(String(from), String(text))) ?? { ok: false, error: "unknown sender" });
});
