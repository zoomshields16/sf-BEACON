import { STATUS_COLORS } from "../api";

const TILES: { key: string; label: string; color?: string }[] = [
  { key: "total", label: "In alert area" },
  { key: "unreached", label: "Unreached", color: STATUS_COLORS.unreached },
  { key: "safe", label: "Safe", color: STATUS_COLORS.safe },
  { key: "needs_help", label: "Needs help", color: STATUS_COLORS.needs_help },
  { key: "critical", label: "Critical", color: STATUS_COLORS.critical },
  { key: "exhausted", label: "Couldn't reach", color: STATUS_COLORS.exhausted },
  { key: "on_call_now", label: "On a call now", color: "#38bdf8" },
  { key: "high_risk_hexes", label: "High-risk zones", color: "#f97316" },
];

export function StatsBar({ stats }: { stats: any }) {
  const total = Number(stats?.total ?? 0);
  const reached = total - Number(stats?.unreached ?? 0) - Number(stats?.exhausted ?? 0);
  const pct = total ? Math.round((reached / total) * 100) : 0;
  return (
    <div className="stats">
      {TILES.map((t) => (
        <div key={t.key} className={`stat ${t.key === "critical" && Number(stats?.critical) > 0 ? "stat-alarm" : ""}`}>
          <div className="stat-value" style={{ color: t.color }}>{stats?.[t.key] ?? "–"}</div>
          <div className="stat-label">{t.label}</div>
        </div>
      ))}
      <div className="stat stat-progress">
        <div className="stat-label">Reached {pct}%</div>
        <div className="progress"><div style={{ width: `${pct}%` }} /></div>
      </div>
    </div>
  );
}
