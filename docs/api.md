# sf-BEACON API
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

### Mobile app (`/api/mobile`)
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/mobile/register` | register a policyholder's phone (E.164) + push token |
| POST | `/api/mobile/location` | latest precise phone location (shared with 911 on escalation) |
| POST | `/api/mobile/sync` | app polls for active alerts |
| POST | `/api/mobile/checkin` | policyholder self check-in from the app |
| POST | `/api/mobile/send-alert` | control panel: send an alert to an area |
| GET | `/api/mobile/users` | registered app users |

