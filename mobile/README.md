# sf-BEACON (HackUTD 2026, State Farm track)

**State Farm Basic Emergency Assistance & Cognitive Outreach Network.** The mobile frontend for sf-BEACON. Built with Expo SDK 58, React Native and Expo Router, in TypeScript.

## Run it on an iPhone

1. Install **Expo Go** from the App Store. It needs to support SDK 58, which the current App Store version does.
2. On your laptop:
   ```bash
   npm install
   npx expo start
   ```
3. Scan the QR code with the iPhone Camera app. It opens in Expo Go.

If the phone and laptop can't see each other (hackathon Wi-Fi often blocks this), run `npx expo start --tunnel` instead.

## Demo script for judges

1. Fresh launch: **Get started**, enter a name and phone, tap **Connect with State Farm** (this fills in the address), confirm the address, answer the home questions (floors, basement, shelter, attic, garage) and pick the rooms that have no windows. sf-BEACON then suggests a spot for each disaster; tap any one to change it or type your own. Finish with **Finish setup**.
2. **Today** tab: tap **Test alert** in the top right. This opens the full-screen tornado check-in with a 30-second countdown.
3. Each choice leads somewhere different:
   - **I'm safe** or **I'm in my safe room** shows a green confirmation.
   - **I need help** shows the packet sent to 911/RapidSOS: address, safe room, household and access notes.
   - **Doing nothing for 30 s** starts the Photon "We're calling you now" fallback.
4. Back on Today you'll see the neighborhood check-in summary (the crowd-sourced grid). Tap **End test** to clear it.
5. **Profile → Demo → Reset app** returns you to onboarding.

## Structure

```
src/
  app/                    Routes (Expo Router)
    onboarding.tsx        Welcome, account, policy link, address, home questions, windowless rooms, suggested plan
    (tabs)/today.tsx      Status, plan progress, live NOAA radar map
    (tabs)/home.tsx       Address, home details, where to go, household, access notes
    weather.tsx           Full-screen radar map
    (tabs)/alerts.tsx     Active and past official alerts
    (tabs)/profile.tsx    User, linked policy, contacts, emergency settings, demo tools
    check-in.tsx          Emergency takeover (countdown, help packet, voice call fallback)
    safe-room/[hazard].tsx, contact/[id].tsx, edit-*.tsx   Edit sheets
  components/ui.tsx       Buttons, rows, fields, chips, stepper
  lib/theme.ts            Colors, type scale, spacing
  lib/hazards.ts          Hazard types, icons, safe room guidance
  lib/plan.ts             Home profile and safe room suggestions per hazard
  lib/geocode.ts          Address to map coordinates (on-device geocoder, never GPS)
  components/weather-map.tsx   Apple Maps + NOAA NEXRAD radar tiles (weather-map.web.tsx is a preview stand-in)
  lib/store.tsx           App state (persisted with AsyncStorage) and mock data
```

## Where the backend plugs in

Everything goes through `src/lib/store.tsx`, so you can wire up the backend without touching any screens:

| Frontend action | Replace with |
|---|---|
| `linkPolicy` (uses `MOCK_POLICY_PULL`) | State Farm policy/OAuth lookup |
| `triggerAlert` / `makeTestAlert()` | Push notification from the NOAA/NWS/USGS monitor |
| `checkIn` | `POST /check-in` → dedup grid; `help` and `no-response` start Photon + Nemotron + RapidSOS |
| `alert.neighborhood` | Zip-code grid aggregates from the backend |
| `saveRoom`, `home`, `household`, `saveContact` | Profile CRUD endpoints |

The `Alert`, `SafeRoom` and `AppState` types at the top of `store.tsx` are a good starting contract for the backend JSON.

## Theme

State Farm red `#D62311` is used for actions and danger, with deep red `#8E1A10` for the emergency screen and green `#1F7A4D` for "safe." The typeface is Public Sans. Tokens live in `src/lib/theme.ts`.
