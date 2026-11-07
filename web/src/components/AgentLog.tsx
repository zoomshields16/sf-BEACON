import { useState } from "react";
import type { LogEntry } from "../api";

const AGENT_COLORS: Record<string, string> = {
  coordinator: "#38bdf8",
  triage: "#a78bfa",
  escalation: "#ef4444",
  system: "#94a3b8",
};

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export function AgentLog({ entries, onSelectPerson }: { entries: LogEntry[]; onSelectPerson: (id: string | number) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!entries.length) return <div className="empty">Agent activity will stream here once an alert is active.</div>;
  return (
    <ul className="log">
      {entries.map((e) => (
        <li key={e.id} className="log-row" onClick={() => setOpen(open === e.id ? null : e.id)}>
          <div className="log-head">
            <span className="log-time">{time(e.created_at)}</span>
            <span className="badge" style={{ background: `${AGENT_COLORS[e.agent] ?? "#64748b"}22`, color: AGENT_COLORS[e.agent] ?? "#94a3b8" }}>
              {e.agent}
            </span>
            {e.tool && <code className="tool">{e.tool}()</code>}
            {e.person_id != null && (
              <button className="link" onClick={(ev) => { ev.stopPropagation(); onSelectPerson(e.person_id!); }}>
                #{e.person_id}
              </button>
            )}
          </div>
          <div className="log-thought">{e.thought}</div>
          {open === e.id && (e.input || e.output) && (
            <pre className="log-json">{JSON.stringify({ input: e.input, output: e.output }, null, 2).slice(0, 4000)}</pre>
          )}
        </li>
      ))}
    </ul>
  );
}
