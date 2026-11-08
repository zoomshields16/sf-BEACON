import { Router } from "express";
import {
  alertStats, hexRisk, listEscalations, logAgent, mapHex, mapPeople, personContext, recentAgentLog, reviewEscalation,
} from "../repo.js";

export const dashboard = Router();

dashboard.get("/alerts/:id/stats", async (req, res) => res.json(await alertStats(req.params.id)));
dashboard.get("/alerts/:id/map/people", async (req, res) => res.json(await mapPeople(req.params.id)));
dashboard.get("/alerts/:id/map/hex", async (req, res) => res.json(await mapHex(req.params.id)));
dashboard.get("/alerts/:id/hex-risk", async (req, res) => res.json(await hexRisk(req.params.id)));

// Poll with ?after=<last id seen> to get only new entries.
dashboard.get("/alerts/:id/log", async (req, res) =>
  res.json(await recentAgentLog(req.params.id, Number(req.query.after ?? 0), Number(req.query.limit ?? 100))));

dashboard.get("/alerts/:id/people/:personId", async (req, res) =>
  res.json(await personContext(req.params.personId, req.params.id)));

dashboard.get("/alerts/:id/escalations", async (req, res) => res.json(await listEscalations(req.params.id)));

// Human-in-the-loop: a responder confirms or dismisses each 911 escalation.
dashboard.post("/escalations/:id/:decision", async (req, res) => {
  const decision = req.params.decision;
  if (decision !== "confirm" && decision !== "dismiss") return res.status(400).json({ error: "confirm or dismiss" });
  const [row] = await reviewEscalation(req.params.id, decision === "confirm" ? "confirmed" : "dismissed");
  if (!row) return res.status(404).json({ error: "not found" });
  await logAgent({
    alertId: row.alert_id, personId: row.person_id, agent: "escalation",
    thought: row.kind === "911"
      ? `Responder ${decision}ed 911 escalation #${row.id}${decision === "confirm" ? " — payload sent to RapidSOS (simulated)" : ""}`
      : `Responder ${decision === "confirm" ? "assigned" : "closed"} ${row.kind === "welfare" ? "welfare check" : "urgent assistance"} #${row.id}`,
  });
  res.json(row);
});
