# sf-BEACON demo runbook (phone app + control panel)

**Flow:** control panel on the laptop → alert over a circle → every app user inside gets a push → they check in on the phone →
no answer in 30 s → the voice agent calls them. "I need help" creates a 911 escalation (pending human review) that includes the
phone's precise GPS (`payload.live_location`) next to the home address.

## One-time
- `npm run db:setup` (new `policyholders` columns: `push_token`, `last_lat`, `last_lng`, `last_seen`).
- `.env`: `MOCK_CALLS=false` for real calls; the phone number the app registers must be in `DEMO_PHONES` / `LIVE_CALL_ALLOWLIST`.
- Remote push in Expo Go needs an EAS project id: `npx eas-cli init` in `mobile/` (needs an Expo login). Without it the app still
  gets alerts by polling while it is open (and shows a local notification).

## Every time (school Wi-Fi blocks phone ↔ laptop, so tunnel both)
1. Postgres running, then `npm run dev` (API, port 3000), `npm run agent` (voice), `npm run web` → http://localhost:5173
2. `cloudflared tunnel --url http://localhost:3000` → copy the https address into `mobile/.env` as `EXPO_PUBLIC_API_URL=...`
   (it changes every restart). Over the tunnel only `/health` and the phone endpoints (`/api/mobile/sync|checkin|register|location`) work.
3. `cd mobile && npx expo start --tunnel --clear` (needs `EXPO_TOKEN`), scan the QR in Expo Go.
4. In the app: onboarding with a FULL phone number (10 digits) and a home address.
5. Dashboard → **Send alert…** → pick the event, center on 📱 your name, radius → Send. Tick "Start the calling agent immediately"
   only if you want the coordinator to call everyone inside.

## Debug
- App never gets the alert: open `<tunnel>/health` on the phone; check the app registered (dashboard "Send alert…" lists 📱 users).
- Expo console says `[beacon] no push token`: see EAS note above.
- Calls are simulated: `MOCK_CALLS=true`, or the number is not allowlisted, or it is a 555 number.
