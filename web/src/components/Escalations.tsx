import type { Escalation } from "../api";
import { pick } from "../api";

interface Props {
  items: Escalation[];
  onReview: (id: number, decision: "confirm" | "dismiss") => void;
  onSelectPerson: (id: string | number) => void;
}

export function Escalations({ items, onReview, onSelectPerson }: Props) {
  const pending = items.filter((e) => e.status === "pending_review");
  const done = items.filter((e) => e.status !== "pending_review").slice(0, 5);
  if (!items.length) return <div className="empty">No 911 escalations. Critical cases appear here for responder review.</div>;

  return (
    <div className="esc-list">
      {pending.map((e) => {
        const p = typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload ?? {};
        return (
          <div key={e.id} className="esc esc-pending">
            <div className="esc-top">
              <span className="esc-tag">911 · PENDING REVIEW</span>
              <button className="link" onClick={() => onSelectPerson(e.person_id)}>#{e.person_id}</button>
            </div>
            <div className="esc-name">{pick(p, ["caller.name"]) ?? `Policyholder ${e.person_id}`}</div>
            <div className="esc-meta">
              {pick(p, ["emergency.type"]) ?? "emergency"} · urgency {pick(p, ["emergency.urgency_score"]) ?? "–"}
              {pick(p, ["emergency.location_in_home"]) ? ` · ${pick(p, ["emergency.location_in_home"])}` : ""}
            </div>
            <div className="esc-reason">{e.reason}</div>
            <div className="esc-addr">{pick(p, ["location.address"]) ?? ""} {pick(p, ["caller.phone"]) ? `· ${pick(p, ["caller.phone"])}` : ""}</div>
            <div className="esc-actions">
              <button className="btn btn-danger" onClick={() => onReview(e.id, "confirm")}>Confirm → RapidSOS</button>
              <button className="btn btn-ghost" onClick={() => onReview(e.id, "dismiss")}>Dismiss</button>
            </div>
          </div>
        );
      })}
      {done.map((e) => (
        <div key={e.id} className="esc esc-done" onClick={() => onSelectPerson(e.person_id)}>
          <span className={e.status === "confirmed" ? "ok" : "muted"}>{e.status === "confirmed" ? "✓ Sent" : "Dismissed"}</span>
          {" "}#{e.person_id} — {e.reason}
        </div>
      ))}
    </div>
  );
}
