// National Weather Service wrapper: pulls live alerts from api.weather.gov and stores them via upsert_nws_alert.
// Most NWS alerts are zone-based (geometry: null) — we rebuild the shape from the affected zones' polygons.
import { upsertNwsAlert, type Row } from "../repo.js";

const BASE = "https://api.weather.gov";
// NWS asks every client to send a descriptive User-Agent.
const UA = process.env.NWS_USER_AGENT || "BEACON/0.1 (HackUTD 2026 demo)";
const MAX_ZONES = 60;

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/geo+json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`NWS ${res.status} for ${url}`);
  return res.json();
}

type Geom = { type: string; coordinates: any } | null;

/** Flattens Polygon / MultiPolygon geometries into one MultiPolygon (overlaps are fine for "is this home inside"). */
export function toMultiPolygon(geoms: Geom[]): { type: "MultiPolygon"; coordinates: any[] } | null {
  const polys: any[] = [];
  for (const g of geoms) {
    if (!g) continue;
    if (g.type === "Polygon") polys.push(g.coordinates);
    else if (g.type === "MultiPolygon") polys.push(...g.coordinates);
  }
  return polys.length ? { type: "MultiPolygon", coordinates: polys } : null;
}

// Only successful zone fetches are cached — a timeout must not drop that zone from the alert for good.
const zoneCache = new Map<string, Geom>();
async function zoneGeometry(url: string): Promise<{ geom: Geom; ok: boolean }> {
  if (zoneCache.has(url)) return { geom: zoneCache.get(url)!, ok: true };
  try {
    const geom = (await getJson(url))?.geometry ?? null;
    zoneCache.set(url, geom);
    return { geom, ok: true };
  } catch {
    return { geom: null, ok: false };
  }
}

/** The alert's own polygon if it has one, otherwise the union of its affected zones.
 *  Returns null if ANY zone failed to load, so we never store a shrunken alert (people would silently fall outside it). */
export async function alertGeometry(feature: Row) {
  if (feature.geometry) return toMultiPolygon([feature.geometry]);
  const zones: string[] = (feature.properties?.affectedZones ?? []).slice(0, MAX_ZONES);
  const results: { geom: Geom; ok: boolean }[] = [];
  for (let i = 0; i < zones.length; i += 6) {                       // 6 at a time — be polite to the API
    results.push(...(await Promise.all(zones.slice(i, i + 6).map(zoneGeometry))));
  }
  if (results.some((r) => !r.ok)) return null;                      // retry next sync instead of shrinking
  return toMultiPolygon(results.map((r) => r.geom));
}

export interface NwsQuery {
  area?: string;              // state code, e.g. "TX"
  point?: [number, number];   // [lat, lon] — alerts covering this point
}

export async function fetchActiveAlerts(q: NwsQuery = {}): Promise<Row[]> {
  const params = new URLSearchParams({ status: "actual", message_type: "alert,update" });
  if (q.point) params.set("point", `${q.point[0].toFixed(4)},${q.point[1].toFixed(4)}`);
  else params.set("area", q.area || process.env.NWS_AREA || "TX");
  const data = await getJson(`${BASE}/alerts/active?${params}`);
  return data.features ?? [];
}

/** Fetch live alerts and upsert them. Returns what was stored; people counts come from alerts_overview(). */
export async function syncNwsAlerts(q: NwsQuery = {}) {
  const features = await fetchActiveAlerts(q);
  const stored: { id: number; nws_id: string; event: string; area: string }[] = [];
  const skipped: string[] = [];
  for (const f of features) {
    const p = f.properties ?? {};
    const geometry = await alertGeometry(f);
    if (!geometry) { skipped.push(`${p.event}: geometry unavailable (zone fetch failed or none) — kept previous shape`); continue; }
    const id = await upsertNwsAlert({
      nwsId: p.id ?? f.id, eventType: p.event, headline: p.headline, description: p.description,
      severity: p.severity, urgency: p.urgency, areaDesc: p.areaDesc, geometry,
      onset: p.onset ?? p.effective ?? null, expires: p.ends ?? p.expires ?? null,
    });
    stored.push({ id, nws_id: p.id ?? f.id, event: p.event, area: (p.areaDesc ?? "").slice(0, 120) });
  }
  console.log(`[nws] ${features.length} active alert(s) → stored ${stored.length}, skipped ${skipped.length}`);
  return { fetched: features.length, stored, skipped };
}

// Optional background check (NWS_POLL_MINUTES > 0). Never auto-activates an alert — a human presses Activate.
export function startNwsPolling() {
  const minutes = Number(process.env.NWS_POLL_MINUTES ?? 0);
  if (!minutes) return;
  const tick = () => syncNwsAlerts().catch((e) => console.error("[nws] poll failed:", (e as Error).message));
  tick();
  setInterval(tick, minutes * 60_000);
  console.log(`[nws] polling every ${minutes} min for ${process.env.NWS_AREA || "TX"}`);
}

