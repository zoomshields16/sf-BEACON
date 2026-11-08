# SF-SafeNet (HackUTD 2026)

Disaster-response agent for State Farm policyholders. When a disaster alert hits an area, a Nemotron
agent finds every policyholder whose home is inside the alert polygon, prioritizes them, places AI
voice calls through Photon, falls back to text, scores urgency from the answers, and shows everything
on a live responder dashboard. Team of 2; hackathon deadline Sunday 12:00 PM CT. Favor working code
over polish.

## Prize tracks (every feature should serve one of these)
- **State Farm** – "The Worst Day, at Scale": find the most urgent, coordinate help, no one overlooked.
- **NVIDIA** – Nemotron *beyond a chatbot*: multi-step agent workflows with real tool calling.
- **Photon** – Best Voice Agent: real calls on a Photon SMS number; the agent must remember the call
  when the conversation moves to text; strong safety/fallback behavior.

## Stack
- Node 20 + TypeScript, Express, `pg` (node-postgres), `tsx` for dev, `dotenv`.
- Postgres 17 + PostGIS 3.7 via Homebrew (`brew install postgresql@17 postgis`). Schema + query functions in `db/`.
  `npm run db:setup` (rebuild + seed), `npm run db:reset` (wipe demo activity), `npm run test:db`.
- Nemotron via NVIDIA's OpenAI-compatible API (`openai` npm package, baseURL
  `https://integrate.api.nvidia.com/v1`). Model name comes from env `NEMOTRON_MODEL`; pick a Nemotron
  model on build.nvidia.com that supports function calling.
- Photon 2.0 (TypeScript SDK "spectrum-ts", docs: https://photon.codes/docs/spectrum-ts/introduction).
  Voice: Photon number ⇄ SIP ⇄ LiveKit Cloud; a LiveKit agent (`src/voice/agent.ts`) runs the call with
  **Nemotron as the live brain** (`src/voice/brain.ts`), LiveKit Inference for STT/TTS. Texts go out on the same number.
  Nemotron: hosted API first; Brev-hosted NIM via `NEMOTRON_BASE_URL` if latency/rate limits bite. Setup: `docs/voice-setup.md`.
- Frontend: `web/` React + Vite + Leaflet, polls the API every 2–3 s (`npm run web`; `?mock=1` = in-browser demo data).

## Database (already written, tested; do not rewrite without asking)
Run order: `db/schema.sql` → `db/functions.sql` → `db/seed.sql`.
Key functions:
- `activate_alert(alert_id)` → starts an alert, creates `unreached` triage rows for everyone inside it.
- `call_queue(alert_id, limit)` → next people to contact, priority-ordered with `reasons[]`; `next_channel` is voice, then sms
  after 2 attempts (backend turns sms into another call while texts are off). 4 unanswered attempts → `exhausted` (trigger).
- `reset_demo(alert_id)` → wipe all activity for an alert. Seed: Braes Bayou flash flood, 1,500 people inside + 100 outside.
- `person_context(person_id, alert_id)` → JSON: profile, SafeRoom, alert, triage, full call/text history.
- `alert_stats(alert_id)` → total / unreached / safe / needs_help / critical / exhausted / high_risk_hexes.
- `hex_risk(alert_id)` → crowdsourced risk per hexagon.
- `map_people_geojson(alert_id)`, `map_hex_geojson(alert_id)` → GeoJSON for the map.
- `upsert_nws_alert(...)` → ingest an NWS alert from its GeoJSON geometry.
- Demo only: `simulate_reports(alert_id, lon, lat, radius_m, n)`.
Tables the backend writes: `contact_attempts`, `conversation_history`, `triage`, `agent_log`, `escalations`.
Column names are mirrored in `src/repo.ts` (the only file with SQL). Tests: `db/test.sql`.

## Agent design (Nemotron)
Three roles, each a ReAct loop (reason → call tool → observe → repeat). Every step writes a row to
`agent_log` (agent, short `thought`, tool, input, output) so the dashboard can show the agent working.
- **Coordinator**: pulls `call_queue`, chooses who to contact and on which channel, re-plans when hex risk changes.
- **Triage**: before a call, writes the script (3 fixed safety questions + 2–3 generated from
  `person_context`); after a call/text, extracts `{status, urgency_score, emergency_type, needs[], location_in_home, notes}` into `triage`.
- **Escalation**: decides if a case goes to 911; builds the simulated RapidSOS payload into `escalations` (status `pending_review` for a human to confirm).

Tools (TypeScript functions exposed via function calling): `get_call_queue`, `get_person_context`,
`generate_call_script`, `place_voice_call`, `send_text`, `get_call_result`, `update_triage`,
`escalate_to_911`, `get_hex_risk`.

## Safety rules (non-negotiable; Photon judges this)
- Fixed core questions always come first: (1) Are you and everyone in your home safe right now?
  (2) Is anyone injured? (3) Is your home safe to stay in tonight?
- Any answer indicating immediate danger → the agent says "Please hang up and call 911 now," triage is set `critical`, and an escalation is created.
- If Nemotron output is invalid JSON or the API errors, fall back to a fixed per-disaster question list. A call never goes out broken.
- Texts must reference the call when one happened ("On our call you said water was rising — is it still rising?") using `conversation_history`.
  **Texting is currently OFF** (`TEXTS_ENABLED=false`, team decision) — calls only.
- Never promise help is coming (`stripFalsePromises`). Only `LIVE_CALL_ALLOWLIST` numbers get real calls; everyone else is simulated.
- `npm test` covers these rules; CI (GitHub Actions) runs it plus DB tests on every push.

## Conventions
- All secrets in `.env` (never commit): `DATABASE_URL`, `NVIDIA_API_KEY`, `NEMOTRON_MODEL`,
  `PHOTON_PROJECT_ID`, `PHOTON_PROJECT_SECRET`, `PHOTON_PHONE_NUMBER`, `LIVEKIT_*`. Keep `.env.example` updated.
- Parameterized SQL only (`$1, $2`); no string-built queries.
- Each external service gets one wrapper module in `src/services/` so it can be mocked; support `MOCK_CALLS=true` to simulate calls/transcripts when the real voice line isn't available (needed for demo backup).
- Small commits with clear messages. Run `npm run typecheck` before saying a task is done.

## Layout
```
db/                 schema.sql, functions.sql, seed.sql
src/
  index.ts          Express app
  db.ts             pg Pool
  repo.ts           all SQL (parameterized)
  routes/           alerts.ts, dashboard.ts, webhooks.ts, internal.ts (voice agent → API)
  agents/           coordinator.ts, triage.ts, escalation.ts, tools.ts, nemotron.ts
  services/         photon.ts, livekit.ts, mock.ts
  voice/            brain.ts (Nemotron call brain), agent.ts (LiveKit worker)
web/                React dashboard
tests/              safety / call-brain / dialing tests (npm test)
scripts/            setup-livekit-trunk.ts, test-call.ts
```
