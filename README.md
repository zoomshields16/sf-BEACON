# SF-SafeNet

Disaster-response voice/text agent for State Farm policyholders (HackUTD 2026). See `CLAUDE.md` for the full scope.

## Setup
```bash
brew install postgresql@17 postgis && brew services start postgresql@17
# if node breaks after installing postgis (libsimdjson error): brew reinstall node
npm install
cp .env.example .env          # fill in keys (get the real .env from a teammate)
npm run db:setup              # creates "safenet", loads schema → functions → seed (re-runnable)
npm run db:reset              # wipe demo activity for alert 1 (then POST /api/alerts/1/activate)
npm run db:snapshot / db:restore   # save/restore db/snapshots/mid-demo.dump (gitignored — share privately)
npm run dev                   # http://localhost:3000/health
```

Before pushing: `npm run typecheck`.

## How it flows
`POST /api/alerts/:id/activate` → coordinator (Nemotron tool loop, rule-based fallback) pulls `call_queue` every 15 s →
voice call (Photon → LiveKit, Nemotron drives the conversation; or mock) with a script = 3 fixed safety questions + generated follow-ups → call ends →
triage extraction (+ keyword safety override → `critical`) → escalation to `escalations` (`pending_review`) →
text follow-up that quotes the call. Every step lands in `agent_log`.

`MOCK_CALLS=true` simulates calls + text replies (stable per person: safe / needs_help / critical / no answer).

## API (for frontend integration)
Base URL `http://localhost:3000`. JSON in/out. The dashboard dev server proxies `/api` and `/health` (see `web/vite.config.ts`). CORS is open.

| Method | Path | Returns / body |
|---|---|---|
| GET | `/health` | `{ok, db, mock, nemotron, nemotron_endpoint, nemotron_model, nemotron_requests{brev,hosted,failovers}, live_call_turns}` |
| GET | `/api/alerts` | alert picker: `[{id, nws_id, event_type, headline, severity, area_desc, status, expires, source: "demo"\|"nws", people_inside}]` |
| POST | `/api/alerts/nws/sync` | pull live NWS alerts (`?area=TX` or `?lat=&lon=`) → `{fetched, stored, skipped, alerts}` |
| POST | `/api/alerts/:id/activate` | start alert + coordinator autopilot (`?autopilot=false` to skip) |
| POST | `/api/alerts/:id/reset` | stop agent + wipe all demo activity for the alert |
| POST | `/api/alerts/:id/round` | one Nemotron coordinator round → `{nemotron, summary}` |
| POST · GET | `/api/alerts/:id/autopilot/start` · `/stop` · `GET /autopilot` | `{running}` |
| POST | `/api/alerts/:id/people/:pid/contact` | `{"channel":"voice"}` → call one person now |
| POST | `/api/alerts/:id/simulate` | `{lon, lat, radius_m, n}` → crowdsourced hazard reports (raises hex risk) |
| GET | `/api/alerts/:id/stats` | `{total, unreached, safe, needs_help, critical, exhausted, on_call_now, attempts, high_risk_hexes, escalations_pending (911), assist_pending (urgent/welfare), do_not_contact}` |
| GET | `/api/alerts/:id/map/people` | GeoJSON points: `{person_id, name, status, urgency_score, attempts, on_call, do_not_contact}` |
| GET | `/api/alerts/:id/map/hex` | GeoJSON hexagons: `{hex_id, risk 0..1, reports, critical, people}` |
| GET | `/api/alerts/:id/hex-risk` | same risk rows, no geometry |
| GET | `/api/alerts/:id/log?after=<id>` | agent activity feed, newest first: `{id, agent, thought, tool, input, output, person_id, created_at}` |
| GET | `/api/alerts/:id/people/:pid` | person panel: `{profile, saferoom, alert, triage, attempts[], history[]}` |
| GET | `/api/alerts/:id/escalations` | `[{id, kind: "911"\|"urgent_assist"\|"welfare", person_id, reason, payload, status, created_at}]` |
| POST | `/api/escalations/:id/confirm` · `/dismiss` | human review (911 = simulated RapidSOS; others = assign responder / close) |
| POST | `/webhooks/sms` | inbound text `{from, text}` (texting is off) |

Statuses: triage `unreached · safe · needs_help · critical · exhausted`. **911 is simulated** — nothing ever contacts real emergency services.
Voice setup: `docs/voice-setup.md` (run `npm run agent` alongside `npm run dev`). Nemotron on Brev: `npm run brev:tunnel`.

## Dashboard
```bash
npm run web:install && npm run web     # http://localhost:5173  (proxies /api → :3000)
```
`http://localhost:5173/?mock=1` runs the dashboard on in-browser demo data (no backend needed). `?alert=<id>` picks the alert.
