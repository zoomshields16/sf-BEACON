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
npm run dev                   # http://localhost:3000/health
```

Before pushing: `npm run typecheck`.

## How it flows
`POST /api/alerts/:id/activate` → coordinator (Nemotron tool loop, rule-based fallback) pulls `call_queue` every 15 s →
voice call (Photon → LiveKit, Nemotron drives the conversation; or mock) with a script = 3 fixed safety questions + generated follow-ups → call ends →
triage extraction (+ keyword safety override → `critical`) → escalation to `escalations` (`pending_review`) →
text follow-up that quotes the call. Every step lands in `agent_log`.

`MOCK_CALLS=true` simulates calls + text replies (stable per person: safe / needs_help / critical / no answer).

## API
| Method | Path | |
|---|---|---|
| POST | `/api/alerts/:id/activate` | activate + start autopilot (`?autopilot=false` to skip) |
| POST | `/api/alerts/:id/round` | run one coordinator round |
| POST | `/api/alerts/:id/autopilot/start` · `/stop` | |
| POST | `/api/alerts/:id/people/:pid/contact` | `{"channel":"voice"\|"sms"}` |
| POST | `/api/alerts/:id/simulate` | `{lon, lat, radius_m, n}` crowdsourced reports |
| GET | `/api/alerts/:id/stats` · `/map/people` · `/map/hex` · `/hex-risk` | |
| GET | `/api/alerts/:id/log?after=<id>` | agent activity feed |
| GET | `/api/alerts/:id/people/:pid` | person_context |
| GET | `/api/alerts/:id/escalations` | |
| POST | `/api/escalations/:id/confirm` · `/dismiss` | human review |
| POST | `/webhooks/sms` | inbound text `{from, text}` |

Voice setup: `docs/voice-setup.md` (run `npm run agent` alongside `npm run dev`). **Table column names are assumed in `src/repo.ts`** — fix there once `db/` lands.

## Dashboard
```bash
npm run web:install && npm run web     # http://localhost:5173  (proxies /api → :3000)
```
`http://localhost:5173/?mock=1` runs the dashboard on in-browser demo data (no backend needed). `?alert=<id>` picks the alert.
