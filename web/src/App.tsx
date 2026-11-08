import { useCallback, useEffect, useRef, useState } from "react";
import { api, MOCK, type LogEntry } from "./api";
import { usePoll } from "./usePoll";
import { StatsBar } from "./components/StatsBar";
import { MapView } from "./components/MapView";
import { AgentLog } from "./components/AgentLog";
import { Escalations } from "./components/Escalations";
import { PersonPanel } from "./components/PersonPanel";

// Inline confirm (no browser dialog): first click arms, second click within 3 s resets.
let resetArmedAt = 0;
function confirmReset() {
  const now = Date.now();
  if (now - resetArmedAt < 3000) { resetArmedAt = 0; return true; }
  resetArmedAt = now;
  return false;
}

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
  const [alertsVersion, setAlertsVersion] = useState(0);
  const alertList = usePoll(() => api.alerts(), 30000, [alertsVersion]);
  const [nwsBusy, setNwsBusy] = useState(false);
  const checkNws = async () => {
    setNwsBusy(true);
    try {
      const r = await api.nwsSync();
      const hit = r.alerts.filter((a) => a.source === "nws" && a.people_inside > 0);
      notify(hit.length
        ? `NWS: ${hit.length} live alert(s) cover ${hit.reduce((n, a) => n + a.people_inside, 0)} policyholders`
        : `NWS: ${r.fetched} live alert(s) in the area — none cover our policyholders right now`);
      setAlertsVersion((v) => v + 1);
    } catch (e) {
      notify(`NWS check failed: ${(e as Error).message}`);
    } finally {
      setNwsBusy(false);
    }
  };
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

  const pending = (escalations.data ?? []).filter((e) => e.status === "pending_review" && (e.kind ?? "911") === "911").length;
  const assistPending = (escalations.data ?? []).filter((e) => e.status === "pending_review" && (e.kind ?? "911") !== "911").length;
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

        <div className="alert-picker">
          <label>Alert</label>
          <select value={alertId} onChange={(e) => { setAlertId(e.target.value); setDraftAlert(e.target.value); setSelected(null); }}>
            {!(alertList.data ?? []).some((a) => String(a.id) === alertId) && <option value={alertId}>#{alertId}</option>}
            {(alertList.data ?? []).map((a) => (
              <option key={a.id} value={String(a.id)}>
                {a.source === "nws" ? "NWS · " : ""}{a.event_type} — {(a.area_desc ?? "").slice(0, 32)} · {a.people_inside.toLocaleString()} policyholders{a.status === "active" ? " · ACTIVE" : ""}
              </option>
            ))}
          </select>
          <button className="btn" disabled={nwsBusy} onClick={checkNws} title="Pull live alerts from the National Weather Service">
            {nwsBusy ? "Checking NWS…" : "Check NWS"}
          </button>
        </div>

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
          <button className="btn btn-ghost" onClick={() => { if (confirmReset()) run("Demo reset — press Activate alert", async () => { await api.reset(alertId); setLog([]); lastLogId.current = 0; setSelected(null); }); }}>Reset</button>
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
            <h3>911 Escalations {pending > 0 && <span className="count">{pending}</span>} <span className="muted">life-or-death only</span></h3>
            <Escalations
              mode="911"
              items={escalations.data ?? []}
              onSelectPerson={setSelected}
              onReview={(id, d) => run(d === "confirm" ? "Escalation sent to RapidSOS (simulated)" : "Escalation dismissed", () => api.review(id, d))}
            />
          </div>
          <div className="panel">
            <h3>Urgent assistance {assistPending > 0 && <span className="count count-assist">{assistPending}</span>} <span className="muted">State Farm responders</span></h3>
            <Escalations
              mode="assist"
              items={escalations.data ?? []}
              onSelectPerson={setSelected}
              onReview={(id, d) => run(d === "confirm" ? "Responder assigned" : "Request closed", () => api.review(id, d))}
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
