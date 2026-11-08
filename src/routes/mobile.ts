// Endpoints for the BEACON phone app. The app identifies the policyholder by phone number (demo-grade; no auth).
import { Router } from "express";
import { activeAlertsForPerson, getTriage, logAgent, personByPhone, updateTriage } from "../repo.js";
import { contactPerson, markCriticalNow } from "../agents/pipeline.js";

export const mobile = Router();

const hazardOf = (event: string) =>
  /tornado/i.test(event) ? "tornado" : /hurricane|tropical/i.test(event) ? "hurricane" : /fire/i.test(event) ? "wildfire"
  : /earthquake/i.test(event) ? "earthquake" : "flood";

// POST { phone } → who we think they are + the active alerts covering their home.
mobile.post("/sync", async (req, res) => {
  const person = await personByPhone(String(req.body?.phone ?? ""));
  if (!person) return res.json({ linked: false, alerts: [] });
  const rows = await activeAlertsForPerson(person.id);
  res.json({
    linked: true,
    person: { id: person.id, name: `${person.first_name} ${person.last_name}`, address: person.address },
    alerts: rows.map((a: any) => ({
      id: `srv-${a.id}`,
      serverId: a.id,
      hazard: hazardOf(a.event_type),
      level: /warning|emergency/i.test(a.event_type) ? "warning" : "watch",
      title: a.event_type,
      area: a.area_desc ?? "",
      source: "National Weather Service",
      issuedAt: new Date(a.onset ?? a.activated_at ?? a.created_at).getTime(),
      expiresAt: a.expires ? new Date(a.expires).getTime() : Date.now() + 6 * 3600_000,
      instructions: a.headline ?? a.description ?? "",
      triageStatus: a.triage_status,
    })),
  });
});

// POST { phone, alertId, status: safe | saferoom | help | no-response }
mobile.post("/checkin", async (req, res) => {
  const { phone, alertId, status, room } = req.body ?? {};
  const person = await personByPhone(String(phone ?? ""));
  if (!person || !Number.isFinite(Number(alertId))) return res.status(404).json({ error: "unknown person or alert" });
  const triage = await getTriage(alertId, person.id);
  if (!triage) return res.status(404).json({ error: "not part of this alert" });

  if (status === "help") {
    await markCriticalNow(alertId, person.id, "Tapped 'I need help' in the BEACON app", ["app_help_request"]);
  } else if (status === "no-response") {
    // The 30 s check-in timer ran out → the voice agent calls them.
    await logAgent({ alertId, personId: person.id, agent: "system", thought: "No answer in the BEACON app — placing the safety call" });
    return res.json(await contactPerson(alertId, person.id, "voice"));
  } else if (status === "safe" || status === "saferoom") {
    if (triage.status !== "critical") { // a human clears critical cases, never the app
      await updateTriage(alertId, person.id, {
        status: "safe", urgency_score: 0, emergency_type: null, needs: [],
        location_in_home: status === "saferoom" ? String(room ?? "safe room") : null,
        notes: `Checked in from the BEACON app (${status === "saferoom" ? "in safe room" : "safe"})`,
      } as any);
      await logAgent({ alertId, personId: person.id, agent: "triage", thought: `App check-in: ${status}` });
    }
  } else return res.status(400).json({ error: "status must be safe, saferoom, help or no-response" });
  res.json({ ok: true });
});
