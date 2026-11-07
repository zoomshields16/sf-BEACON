# SF-SafeNet

Disaster-response voice/text agent for State Farm policyholders (HackUTD 2026). See `CLAUDE.md` for the full scope.

## Setup
```bash
npm install
cp .env.example .env          # fill in keys
createdb safenet && psql safenet -c "create extension if not exists postgis"
npm run db:setup              # schema → functions → seed
npm run dev                   # http://localhost:3000/health
```

Before pushing: `npm run typecheck`.

## How it flows
`POST /api/alerts/:id/activate` → coordinator (Nemotron tool loop, rule-based fallback) pulls `call_queue` every 15 s →
voice call (Retell, or mock) with a script = 3 fixed safety questions + generated follow-ups → `call_ended` webhook →
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
| POST | `/webhooks/retell` | Retell `call_ended` |
| POST | `/webhooks/sms` | inbound text `{from, text}` |

Retell setup: `docs/retell-agent-prompt.md`. **Table column names are assumed in `src/repo.ts`** — fix there once `db/` lands.
