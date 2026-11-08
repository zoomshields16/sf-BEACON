import type { Escalation } from "../api";
import { pick } from "../api";

interface Props {
  items: Escalation[];
  mode: "911" | "assist";
  onReview: (id: number, decision: "confirm" | "dismiss") => void;
  onSelectPerson: (id: string | number) => void;
}

const isMode = (e: Escalation, mode: Props["mode"]) => ((e.kind ?? "911") === "911") === (mode === "911");

export function Escalations({ items, mode, onReview, onSelectPerson }: Props) {
  const mine = items.filter((e) => isMode(e, mode));
  const pending = mine.filter((e) => e.status === "pending_review");
  const done = mine.filter((e) => e.status !== "pending_review").slice(0, 5);
  if (!mine.length) {
    return <div className="empty">{mode === "911"
      ? "No 911 escalations. Only life-or-death cases appear here."
      : "No urgent assistance requests. Medication, power, transport and welfare checks appear here."}</div>;
  }

  return (
    <div className="esc-list">
      {pending.map((e) => {
        const p = typeof e.payload === "string" ? JSON.parse(e.payload) : e.payload ?? {};
        const tag = mode === "911" ? "911 · LIFE-THREATENING · PENDING REVIEW" : e.kind === "welfare" ? "WELFARE CHECK" : "URGENT ASSISTANCE";
        return (
          <div key={e.id} className={`esc ${mode === "911" ? "esc-pending" : "esc-assist"}`}>
            <div className="esc-top">
              <span className={mode === "911" ? "esc-tag" : "esc-tag esc-tag-assist"}>{tag}</span>
              <button className="link" onClick={() => onSelectPerson(e.person_id)}>#{e.person_id}</button>
            </div>
            <div className="esc-name">{pick(p, ["caller.name"]) ?? `Policyholder ${e.person_id}`}</div>
            <div className="esc-meta">
              {pick(p, ["emergency.type"]) ?? (mode === "911" ? "emergency" : "assistance")} · urgency {pick(p, ["emergency.urgency_score"]) ?? "–"}
              {pick(p, ["emergency.location_in_home"]) ? ` · ${pick(p, ["emergency.location_in_home"])}` : ""}
            </div>
            <div className="esc-reason">{e.reason}</div>
            <div className="esc-addr">{pick(p, ["location.address"]) ?? ""} {pick(p, ["caller.phone"]) ? `· ${pick(p, ["caller.phone"])}` : ""}</div>
            <div className="esc-actions">
              {mode === "911"
                ? <button className="btn btn-danger" onClick={() => onReview(e.id, "confirm")}>Confirm → RapidSOS</button>
                : <button className="btn btn-assist" onClick={() => onReview(e.id, "confirm")}>Assign responder</button>}
              <button className="btn btn-ghost" onClick={() => onReview(e.id, "dismiss")}>{mode === "911" ? "Dismiss" : "Not needed"}</button>
            </div>
          </div>
        );
      })}
      {done.map((e) => (
        <div key={e.id} className="esc esc-done" onClick={() => onSelectPerson(e.person_id)}>
          <span className={e.status === "confirmed" ? "ok" : "muted"}>
            {e.status === "confirmed" ? (mode === "911" ? "✓ Sent" : "✓ Assigned") : "Dismissed"}
          </span>
          {" "}#{e.person_id} — {e.reason}
        </div>
      ))}
    </div>
  );
}
