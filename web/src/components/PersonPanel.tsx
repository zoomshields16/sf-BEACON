import { api, pick, STATUS_COLORS, STATUS_LABEL } from "../api";
import { usePoll } from "../usePoll";

interface Props {
  alertId: string;
  personId: string | number;
  onClose: () => void;
  notify: (msg: string) => void;
}

export function PersonPanel({ alertId, personId, onClose, notify }: Props) {
  const { data: ctx, error } = usePoll(() => api.person(alertId, personId), 3000, [alertId, personId]);
  const profile = ctx?.profile ?? ctx?.person ?? {};
  const triage = ctx?.triage ?? {};
  const history: any[] = pick(ctx, ["history", "conversation_history", "conversation"]) ?? [];
  const status = triage.status ?? "unreached";
  const needs: string[] = Array.isArray(triage.needs) ? triage.needs : [];

  const contact = async (channel: "voice" | "sms") => {
    try {
      const r = await api.contact(alertId, personId, channel);
      notify(r?.status === "skipped" ? "Contact already in progress" : channel === "voice" ? "Call started" : "Text sent");
    } catch (e) {
      notify(`Failed: ${(e as Error).message}`);
    }
  };

  return (
    <aside className="person">
      <div className="person-head">
        <div>
          <div className="person-name">{pick(profile, ["name", "full_name", "first_name"]) ?? `Policyholder #${personId}`}</div>
          <div className="muted">{pick(profile, ["address"]) ?? ""}</div>
        </div>
        <button className="btn btn-ghost" onClick={onClose}>✕</button>
      </div>
      {error && <div className="err">{error}</div>}

      <div className="person-status">
        <span className="pill" style={{ background: STATUS_COLORS[status] ?? "#64748b" }}>{STATUS_LABEL[status] ?? status}</span>
        {triage.urgency_score != null && <span className="urgency">Urgency <b>{triage.urgency_score}</b>/100</span>}
      </div>

      <dl className="facts">
        {[
          ["Phone", pick(profile, ["phone"])],
          ["Household", pick(profile, ["household_size", "household"])],
          ["Age", pick(profile, ["age"])],
          ["Medical", pick(profile, ["medical_needs", "medical"])],
          ["SafeRoom", pick(ctx, ["saferoom.name", "saferoom.location", "safe_room"])],
          ["Needs", needs.join(", ")],
          ["Location in home", triage.location_in_home],
        ].filter(([, v]) => v != null && v !== "").map(([k, v]) => (
          <div key={k as string}><dt>{k}</dt><dd>{String(v)}</dd></div>
        ))}
      </dl>
      {triage.notes && <div className="notes">{triage.notes}</div>}

      <div className="person-actions">
        <button className="btn" onClick={() => contact("voice")}>📞 Call now</button>
        <button className="btn" onClick={() => contact("sms")}>💬 Follow up by text</button>
      </div>

      <h4>Conversation</h4>
      {history.length === 0 && <div className="empty">No contact yet.</div>}
      <div className="chat">
        {history.map((m, i) => {
          const role = m.role ?? m.speaker;
          const channel = m.channel ?? "voice";
          return (
            <div key={i} className={`bubble ${role === "user" ? "bubble-user" : "bubble-agent"}`}>
              <span className="bubble-ch">{channel === "sms" ? "TEXT" : "CALL"}</span>
              {m.content ?? m.text}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
