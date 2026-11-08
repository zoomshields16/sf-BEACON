import { useEffect, useState } from "react";
import { api } from "../api";

const EVENTS = ["Tornado Warning", "Flash Flood Warning", "Severe Thunderstorm Warning", "Red Flag Warning (wildfire)", "Hurricane Warning", "Earthquake Alert"];
const PLACES: [string, number, number, string][] = [
  ["Collin County, TX (Plano)", 33.0198, -96.6989, "Collin County"],
  ["Dallas County, TX (Richardson)", 32.9483, -96.7299, "Dallas County"],
  ["Harris County, TX (Houston)", 29.7, -95.45, "Harris County"],
];

/** Control panel: pick an event and an area, and every BEACON app user inside gets a push notification. */
export function SendAlert({ onSent, notify }: { onSent: (alertId: string) => void; notify: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<{ id: number; name: string; address: string; lat: number; lng: number }[]>([]);
  const [event, setEvent] = useState(EVENTS[0]);
  const [where, setWhere] = useState("place:0");
  const [km, setKm] = useState(8);
  const [agent, setAgent] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (open) api.appUsers().then(setUsers).catch(() => {}); }, [open]);

  const send = async () => {
    const [kind, i] = where.split(":");
    const [lat, lng, area] = kind === "user"
      ? (({ lat, lng, address }) => [lat, lng, address.split(",").slice(-2).join(",").trim() || "your area"] as const)(users[Number(i)])
      : [PLACES[Number(i)][1], PLACES[Number(i)][2], PLACES[Number(i)][3]] as const;
    setBusy(true);
    try {
      const r = await api.sendAlert({ event_type: event.replace(/ \(.*\)/, ""), lat, lng, radius_km: km, area, autopilot: agent });
      notify(`${event} sent — ${r.result?.people ?? "?"} policyholders inside, ${r.pushed} phone(s) notified`);
      onSent(String(r.alertId));
      setOpen(false);
    } catch (e) { notify(`Error: ${(e as Error).message}`); } finally { setBusy(false); }
  };

  if (!open) return <button className="btn btn-primary" onClick={() => setOpen(true)}>Send alert…</button>;
  return (
    <div className="panel" style={{ position: "absolute", top: 64, right: 12, zIndex: 50, width: 340, display: "grid", gap: 8, padding: 14 }}>
      <h3>Send an alert</h3>
      <label>Event<select value={event} onChange={(e) => setEvent(e.target.value)}>{EVENTS.map((x) => <option key={x}>{x}</option>)}</select></label>
      <label>Area centered on
        <select value={where} onChange={(e) => setWhere(e.target.value)}>
          {users.map((u, i) => <option key={u.id} value={`user:${i}`}>📱 {u.name} — {u.address}</option>)}
          {PLACES.map((p, i) => <option key={p[0]} value={`place:${i}`}>{p[0]}</option>)}
        </select>
      </label>
      <label>Radius: {km} km<input type="range" min={2} max={40} value={km} onChange={(e) => setKm(Number(e.target.value))} /></label>
      <label><input type="checkbox" checked={agent} onChange={(e) => setAgent(e.target.checked)} /> Start the calling agent immediately (calls everyone inside)</label>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn btn-primary" disabled={busy} onClick={send}>{busy ? "Sending…" : "Send"}</button>
        <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}
