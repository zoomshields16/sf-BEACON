import { Router } from "express";
import { activateAlert, alertsOverview, logAgent, resetDemo, simulateReports } from "../repo.js";
import { syncNwsAlerts } from "../services/nws.js";
import { coordinatorRound, isAutopilot, startAutopilot, stopAutopilot } from "../agents/coordinator.js";
import { contactPerson, forgetAlert } from "../agents/pipeline.js";

export const alerts = Router();

// Alert picker: demo + live NWS alerts, each with how many policyholders live inside it.
alerts.get("/", async (_req, res) => res.json(await alertsOverview()));

// Pull live alerts from the National Weather Service (default area NWS_AREA, or ?area=OK / ?lat=..&lon=..).
alerts.post("/nws/sync", async (req, res) => {
  const lat = Number(req.query.lat), lon = Number(req.query.lon);
  const q = Number.isFinite(lat) && Number.isFinite(lon) ? { point: [lat, lon] as [number, number] }
          : { area: typeof req.query.area === "string" ? req.query.area.toUpperCase().slice(0, 2) : undefined };
  try {
    const result = await syncNwsAlerts(q);
    res.json({ ...result, alerts: await alertsOverview() });
  } catch (e) {
    res.status(502).json({ error: `NWS unavailable: ${(e as Error).message}` });
  }
});

// Activate an alert and start the coordinator.
alerts.post("/:id/activate", async (req, res) => {
  const id = req.params.id;
  const result = await activateAlert(id);
  await logAgent({ alertId: id, agent: "system", thought: "Alert activated — triage rows created", output: result });
  const autopilot = req.query.autopilot !== "false";
  if (autopilot) startAutopilot(id);
  res.json({ ok: true, result, autopilot });
});

// Demo rehearsal: stop the agent and wipe all activity for this alert (then press Activate again).
alerts.post("/:id/reset", async (req, res) => {
  stopAutopilot(req.params.id);
  forgetAlert(req.params.id);          // otherwise people mid-call stay blocked for up to 12 min after the reset
  res.json(await resetDemo(req.params.id));
});

alerts.post("/:id/autopilot/start", (req, res) => res.json({ started: startAutopilot(req.params.id) }));
alerts.post("/:id/autopilot/stop", (req, res) => res.json({ stopped: stopAutopilot(req.params.id) }));
alerts.get("/:id/autopilot", (req, res) => res.json({ running: isAutopilot(req.params.id) }));

// Run one coordinator round by hand.
alerts.post("/:id/round", async (req, res) => res.json(await coordinatorRound(req.params.id)));

// Contact one person directly (dashboard "Call now" / "Follow up by text" buttons).
alerts.post("/:id/people/:personId/contact", async (req, res) => {
  const channel = req.body?.channel === "sms" ? "sms" : "voice";
  res.json(await contactPerson(req.params.id, req.params.personId, channel));
});

// Demo only: crowdsourced reports around a point, to shift hex risk.
alerts.post("/:id/simulate", async (req, res) => {
  const { lon, lat, radius_m = 800, n = 25 } = req.body ?? {};
  if (typeof lon !== "number" || typeof lat !== "number") return res.status(400).json({ error: "lon and lat (numbers) required" });
  const result = await simulateReports(req.params.id, lon, lat, Number(radius_m), Number(n));
  await logAgent({ alertId: req.params.id, agent: "system", thought: `Simulated ${n} reports near ${lat.toFixed(3)},${lon.toFixed(3)}` });
  res.json({ ok: true, result });
});
