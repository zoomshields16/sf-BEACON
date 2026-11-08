// Endpoints the LiveKit agent process calls. Not for the dashboard.
import { Router } from "express";
import { dropCallSession, getCallSession } from "../voice/brain.js";
import { generateCallScript } from "../agents/triage.js";
import { flagForReview, handleCallEnded, markCriticalNow } from "../agents/pipeline.js";
import { findAttempt, personContext } from "../repo.js";

export const internal = Router();

internal.use((req, res, next) => {
  const token = process.env.INTERNAL_TOKEN;
  if (token && req.header("x-internal-token") !== token) return res.status(401).json({ error: "unauthorized" });
  next();
});

// Session for a call: person context + script. Rebuilt from the DB if the API restarted mid-call.
internal.get("/calls/:attemptId", async (req, res) => {
  const cached = getCallSession(req.params.attemptId);
  if (cached) return res.json(cached);
  const attempt = await findAttempt(req.params.attemptId);
  if (!attempt) return res.status(404).json({ error: "unknown attempt" });
  const ctx = await personContext(attempt.person_id, attempt.alert_id);
  const script = await generateCallScript(ctx, attempt.alert_id, attempt.person_id);
  res.json({ alertId: attempt.alert_id, personId: attempt.person_id, attemptId: attempt.id, ctx, script });
});

// Mid-call danger: mark critical + escalate immediately, before the call even ends.
internal.post("/calls/:attemptId/danger", async (req, res) => {
  const attempt = await findAttempt(req.params.attemptId);
  if (!attempt) return res.status(404).json({ error: "unknown attempt" });
  await markCriticalNow(attempt.alert_id, attempt.person_id, String(req.body?.text ?? ""), req.body?.matched ?? []);
  res.json({ ok: true });
});

// Risk-model disagreement on a live call → human review (urgent assistance), never 911.
internal.post("/calls/:attemptId/review", async (req, res) => {
  const attempt = await findAttempt(req.params.attemptId);
  if (!attempt) return res.status(404).json({ error: "unknown attempt" });
  await flagForReview(attempt.alert_id, attempt.person_id, String(req.body?.text ?? ""), String(req.body?.reason ?? "Model disagreement"));
  res.json({ ok: true });
});

internal.post("/calls/:attemptId/ended", async (req, res) => {
  res.json({ ok: true });
  dropCallSession(req.params.attemptId);
  await handleCallEnded({
    attemptId: req.params.attemptId,
    answered: Boolean(req.body?.answered),
    outcome: req.body?.outcome,
    transcript: Array.isArray(req.body?.transcript) ? req.body.transcript : [],
  }).catch((e) => console.error("call ended", e));
});
