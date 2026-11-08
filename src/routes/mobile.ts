// Endpoints for the BEACON phone app. The app identifies the policyholder by phone number (demo-grade; no auth).
import { Router } from "express";
import {
  activateAlert, activeAlertsForPerson, appUsers, getTriage, logAgent, personByPhone, pushTokensInAlert, registerPerson, saveLocation,
  updateTriage, upsertNwsAlert,
} from "../repo.js";
import { startAutopilot } from "../agents/coordinator.js";
import { sendPush } from "../services/push.js";
import { contactPerson, markCriticalNow } from "../agents/pipeline.js";

export const mobile = Router();

// POST: the app's onboarding → creates (or updates) the policyholder for this phone.
mobile.post("/register", async (req, res) => {
  const b = req.body ?? {};
  const lat = Number(b.lat), lng = Number(b.lng);
  if (!b.phone || !b.name || !Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: "name, phone, lat, lng required" });
  const id = await registerPerson({
    name: String(b.name), phone: String(b.phone), address: String(b.address ?? "Address not given"), lat, lng,
    adults: Math.max(1, Number(b.adults) || 1), children: Math.max(0, Number(b.children) || 0),
    pets: Number(b.pets) > 0 ? `${Number(b.pets)} pets` : null, needs: b.needs ? String(b.needs) : null,
    safeRoom: b.safeRoom ? String(b.safeRoom) : null, pushToken: b.pushToken ? String(b.pushToken) : null,
  });
  res.json({ ok: true, personId: id });
});

// POST { phone, lat, lng }: latest precise phone location (goes to 911 only if there is an escalation).
mobile.post("/location", async (req, res) => {
  const person = await personByPhone(String(req.body?.phone ?? ""));
  const lat = Number(req.body?.lat), lng = Number(req.body?.lng);
  if (!person || !Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: "known phone, lat, lng required" });
  await saveLocation(person.id, lat, lng);
  res.json({ ok: true });
});

// Dashboard control panel: who has the app, and "send an alert to this area".
mobile.get("/users", async (_req, res) => res.json(await appUsers()));

const circle = (lat: number, lng: number, km: number) => ({
  type: "Polygon",
  coordinates: [Array.from({ length: 65 }, (_, i) => {
    const a = (i % 64) / 64 * 2 * Math.PI;
    return [lng + (km / (111.32 * Math.cos(lat * Math.PI / 180))) * Math.cos(a), lat + (km / 111.32) * Math.sin(a)];
  })],
});

// POST { event_type, lat, lng, radius_km, area?, autopilot? } → creates + activates a demo alert over a circle, pushes to app users inside.
mobile.post("/send-alert", async (req, res) => {
  const { event_type = "Tornado Warning", area = "your area", autopilot = false } = req.body ?? {};
  const lat = Number(req.body?.lat), lng = Number(req.body?.lng), km = Math.min(100, Math.max(1, Number(req.body?.radius_km) || 8));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return res.status(400).json({ error: "lat and lng required" });
  const alertId = await upsertNwsAlert({
    nwsId: `demo-app-${Date.now()}`, eventType: String(event_type), areaDesc: String(area), severity: "Severe", urgency: "Immediate",
    headline: `${event_type} for ${area} until ${new Date(Date.now() + 3600_000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`,
    description: "Take shelter now. Check in on your BEACON app.", geometry: circle(lat, lng, km),
    onset: new Date().toISOString(), expires: new Date(Date.now() + 3600_000).toISOString(),
  });
  const result = await activateAlert(alertId);
  await logAgent({ alertId, agent: "system", thought: `${event_type} sent from the control panel — triage rows created`, output: result });
  if (autopilot) startAutopilot(alertId);
  const tokens = await pushTokensInAlert(alertId);
  const pushed = await sendPush(tokens, String(event_type), `${area}. Open BEACON and check in.`, { alertId }).catch((e) => { console.error(e); return 0; });
  res.json({ ok: true, alertId, result, pushed });
});

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
  const { phone, alertId, status, room, lat, lng } = req.body ?? {};
  const person = await personByPhone(String(phone ?? ""));
  if (person && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) await saveLocation(person.id, Number(lat), Number(lng));
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
