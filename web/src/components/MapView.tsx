import { useEffect, useRef } from "react";
import { CircleMarker, GeoJSON, MapContainer, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import { pick, STATUS_COLORS, STATUS_LABEL } from "../api";

interface Props {
  people: any;
  hex: any;
  selected: string | number | null;
  onSelect: (personId: string | number) => void;
  simulateMode: boolean;
  onSimulate: (lon: number, lat: number) => void;
}

const riskColor = (r: number) => (r > 0.6 ? "#ef4444" : r > 0.35 ? "#f97316" : r > 0.15 ? "#facc15" : "#38bdf8");

function FitOnce({ points }: { points: [number, number][] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || points.length === 0) return;
    map.fitBounds(L.latLngBounds(points), { padding: [30, 30] });
    done.current = true;
  }, [points, map]);
  return null;
}

function ClickToSimulate({ enabled, onSimulate }: { enabled: boolean; onSimulate: Props["onSimulate"] }) {
  useMapEvents({ click: (e) => enabled && onSimulate(e.latlng.lng, e.latlng.lat) });
  return null;
}

export function MapView({ people, hex, selected, onSelect, simulateMode, onSimulate }: Props) {
  const features: any[] = people?.features ?? [];
  const pts = features
    .filter((f) => f.geometry?.type === "Point")
    .map((f) => {
      const p = f.properties ?? {};
      return {
        id: pick(p, ["person_id", "id"]),
        name: pick(p, ["name", "full_name"]) ?? "Policyholder",
        status: pick(p, ["status", "triage_status"]) ?? "unreached",
        urgency: Number(pick(p, ["urgency_score", "urgency"]) ?? 0),
        onCall: Boolean(p.on_call),
        latlng: [f.geometry.coordinates[1], f.geometry.coordinates[0]] as [number, number],
      };
    })
    // draw critical last so it sits on top
    .sort((a, b) => (a.status === "critical" ? 1 : 0) - (b.status === "critical" ? 1 : 0));

  // Outline points of the hex grid: lets the map zoom to an alert area even when it has no seeded policyholders.
  const hexPoints: [number, number][] = (hex?.features ?? []).flatMap((f: any) =>
    (f.geometry?.coordinates?.[0] ?? []).map((c: number[]) => [c[1], c[0]] as [number, number]));
  const hexKey = JSON.stringify((hex?.features ?? []).map((f: any) => f.properties?.risk ?? f.properties?.risk_score));

  return (
    <MapContainer center={[29.76, -95.37]} zoom={12} className={`map ${simulateMode ? "map-sim" : ""}`} preferCanvas>
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        className="dark-tiles"
        attribution='&copy; OpenStreetMap contributors'
      />
      {hex?.features?.length > 0 && (
        <GeoJSON
          key={hexKey}
          data={hex}
          style={(f: any) => {
            const r = Number(f?.properties?.risk ?? f?.properties?.risk_score ?? 0);
            return { color: riskColor(r), weight: 1, fillColor: riskColor(r), fillOpacity: 0.08 + r * 0.35, opacity: 0.5 };
          }}
        />
      )}
      {pts.map((p) => (
        <CircleMarker
          key={p.id}
          center={p.latlng}
          radius={p.status === "critical" ? 9 : p.id === selected || p.onCall ? 8 : 5}
          pathOptions={{
            color: p.id === selected ? "#fff" : p.onCall ? "#38bdf8" : STATUS_COLORS[p.status] ?? "#64748b",
            weight: p.id === selected ? 2.5 : p.onCall ? 3 : 1,
            fillColor: STATUS_COLORS[p.status] ?? "#64748b",
            fillOpacity: p.status === "unreached" ? 0.55 : 0.9,
            className: p.status === "critical" || p.onCall ? "pulse" : undefined,
          }}
          eventHandlers={{ click: () => onSelect(p.id) }}
        >
          <Tooltip direction="top" offset={[0, -6]}>
            <b>{p.name}</b> · {p.onCall ? "📞 on a call · " : ""}{STATUS_LABEL[p.status] ?? p.status}{p.urgency ? ` · ${p.urgency}` : ""}
          </Tooltip>
        </CircleMarker>
      ))}
      <FitOnce points={pts.length ? pts.map((p) => p.latlng) : hexPoints} />
      <ClickToSimulate enabled={simulateMode} onSimulate={onSimulate} />
    </MapContainer>
  );
}
