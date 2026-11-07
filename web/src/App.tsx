import { useCallback, useEffect, useRef, useState } from "react";
import { api, MOCK, type LogEntry } from "./api";
import { usePoll } from "./usePoll";
import { StatsBar } from "./components/StatsBar";
import { MapView } from "./components/MapView";
import { AgentLog } from "./components/AgentLog";
import { Escalations } from "./components/Escalations";
import { PersonPanel } from "./components/PersonPanel";

const initialAlert = new URLSearchParams(location.search).get("alert") ?? "1";

export default function App() {
  const [alertId, setAlertId] = useState(initialAlert);
  const [draftAlert, setDraftAlert] = useState(initialAlert);
  const [selected, setSelected] = useState<string | number | null>(null);
  const [simulateMode, setSimulateMode] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const lastLogId = useRef(0);

  const notify = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 3000);
  }, []);

  const health = usePoll(() => api.health(), 10000, []);
  const stats = usePoll(() => api.stats(alertId), 2500, [alertId]);
  const people = usePoll(() => api.people(alertId), 3000, [alertId]);
  const hex = usePoll(() => api.hex(alertId), 5000, [alertId]);
  const escalations = usePoll(() => api.escalations(alertId), 2500, [alertId]);
  const autopilot = usePoll(() => api.autopilot(alertId), 3000, [alertId]);

  // Agent log: incremental polling, newest first.
  useEffect(() => {
    setLog([]);
    lastLogId.current = 0;
    let alive = true;
    const tick = async () => {
      try {
        const rows = await api.log(alertId, lastLogId.current);
        if (!alive || !rows.length) return;
        lastLogId.current = Math.max(lastLogId.current, ...rows.map((r) => Number(r.id)));
        setLog((prev) => [...rows, ...prev].slice(0, 400));
      } catch {}
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [alertId]);

  const run = async (label: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      notify(label);
    } catch (e) {
      notify(`Error: ${(e as Error).message}`);
    }
  };

  const pending = (escalations.data ?? []).filter((e) => e.status === "pending_review").length;
  const apiDown = !MOCK && (health.error || health.data?.db === false);

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo">◉</span>
          <div>
            <div className="brand-name">SafeNet</div>
            <div className="brand-sub">State Farm · Disaster Response</div>
          </div>
        </div>

        <form className="alert-picker" onSubmit={(e) => { e.preventDefault(); setAlertId(draftAlert.trim()); setSelected(null); }}>
          <label>Alert</label>
          <input value={draftAlert} onChange={(e) => setDraftAlert(e.target.value)} />
        </form>

        <div className="chips">
          {MOCK && <span className="chip chip-warn">DEMO DATA</span>}
          {health.data && !MOCK && <span className={`chip ${health.data.mock ? "chip-warn" : "chip-ok"}`}>{health.data.mock ? "Simulated calls" : "Live voice"}</span>}
          {health.data && <span className={`chip ${health.data.nemotron ? "chip-ok" : "chip-warn"}`}>Nemotron {health.data.nemotron ? "on" : "fallback"}</span>}
          {autopilot.data?.running && <span className="chip chip-live">● Agent running</span>}
        </div>

        <div className="actions">
          <button className="btn btn-primary" onClick={() => run("Alert activated — agent dispatching", () => api.activate(alertId))}>Activate alert</button>
          <button className="btn" onClick={() => run(autopilot.data?.running ? "Autopilot paused" : "Autopilot started", () => api.setAutopilot(alertId, !autopilot.data?.running))}>
            {autopilot.data?.running ? "Pause agent" : "Resume agent"}
          </button>
          <button className="btn" onClick={() => run("Coordinator round started", () => api.round(alertId))}>Run round</button>
          <button className={`btn ${simulateMode ? "btn-active" : ""}`} onClick={() => setSimulateMode((s) => !s)}
                  title="Click the map to drop 25 crowdsourced hazard reports">
            {simulateMode ? "Click map to report…" : "Simulate reports"}
          </button>
        </div>
      </header>

      {apiDown && (
        <div className="banner">
          API/database not reachable{health.error ? ` (${health.error})` : ""}. Start the backend with <code>npm run dev</code>, or open <a href="?mock=1">demo mode</a>.
        </div>
      )}

      <StatsBar stats={stats.data} />

      <main className="main">
        <section className="map-wrap">
          <MapView
            people={people.data}
            hex={hex.data}
            selected={selected}
            onSelect={setSelected}
            simulateMode={simulateMode}
            onSimulate={(lon, lat) => {
              setSimulateMode(false);
              run("Hazard reports added — agent re-planning", () => api.simulate(alertId, lon, lat));
            }}
          />
          <div className="legend">
            {[["critical", "Critical"], ["needs_help", "Needs help"], ["safe", "Safe"], ["unreached", "Unreached"], ["exhausted", "Couldn't reach"]].map(([k, l]) => (
              <span key={k}><i className={`dot dot-${k}`} />{l}</span>
            ))}
          </div>
          {selected != null && (
            <PersonPanel alertId={alertId} personId={selected} onClose={() => setSelected(null)} notify={notify} />
          )}
        </section>

        <aside className="side">
          <div className="panel">
            <h3>911 Escalations {pending > 0 && <span className="count">{pending}</span>}</h3>
            <Escalations
              items={escalations.data ?? []}
              onSelectPerson={setSelected}
              onReview={(id, d) => run(d === "confirm" ? "Escalation sent to RapidSOS (simulated)" : "Escalation dismissed", () => api.review(id, d))}
            />
          </div>
          <div className="panel panel-grow">
            <h3>Agent activity <span className="muted">Nemotron · live</span></h3>
            <AgentLog entries={log} onSelectPerson={setSelected} />
          </div>
        </aside>
      </main>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
