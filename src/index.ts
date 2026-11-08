import "dotenv/config";
import express from "express";
import { pool } from "./db.js";
import { alerts } from "./routes/alerts.js";
import { dashboard } from "./routes/dashboard.js";
import { webhooks } from "./routes/webhooks.js";
import { internal } from "./routes/internal.js";
import { nemotronEnabled } from "./agents/nemotron.js";
import { liveCallStats } from "./voice/brain.js";
import { startNwsPolling } from "./services/nws.js";
import { closeOrphanedAttempts } from "./repo.js";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*"); // dashboard dev server
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  next();
});

app.get("/health", async (_req, res) => {
  let db = false;
  try {
    await pool.query("select 1");
    db = true;
  } catch {}
  res.status(db ? 200 : 500).json({
    ok: db, db, mock: process.env.MOCK_CALLS === "true", nemotron: nemotronEnabled(),
    nemotron_endpoint: process.env.NEMOTRON_BASE_URL || "https://integrate.api.nvidia.com/v1 (hosted)",
    nemotron_model: process.env.NEMOTRON_MODEL ?? null,
    // Turns on REAL calls handled in this API process (mock calls excluded). The LiveKit agent prints its own.
    live_call_turns: liveCallStats,
  });
});

app.use("/api/alerts", alerts);
app.use("/api", dashboard);
app.use("/webhooks", webhooks);
app.use("/internal", internal);

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const port = Number(process.env.PORT ?? 3000);
startNwsPolling();
closeOrphanedAttempts()
  .then((n) => n && console.log(`[startup] closed ${n} call attempt(s) orphaned by a restart — those people are back in the queue`))
  .catch((e) => console.error("[startup] orphan cleanup failed:", e.message));
app.listen(port, () =>
  console.log(`SF-SafeNet API on http://localhost:${port}  (mock=${process.env.MOCK_CALLS === "true"}, nemotron=${nemotronEnabled()})`));
