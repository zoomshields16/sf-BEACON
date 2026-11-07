# Voice setup: Photon → LiveKit → Nemotron

```
policyholder phone ⇄ Photon number ⇄ (SIP/TLS) ⇄ LiveKit Cloud room ⇄ safenet-caller agent (npm run agent)
                                                                          STT/TTS: LiveKit Inference
                                                                          brain:   Nemotron via CallBrain (src/voice/brain.ts)
```
The backend dials (`createSipParticipant` on the Photon outbound trunk), waits for answer, then dispatches the
agent into the room. No ngrok needed for voice — the agent connects out to LiveKit Cloud.

Official guide: https://photon.codes/docs/beta/cookbooks/voice/livekit.md

## Steps (outbound is what we need first)
1. **Photon dashboard** → Voice → your number under Lines → *Set up default* profile → SIP. Media encryption: Auto.
2. Photon profile → **Outbound calls**: digest SHA-256, enable, **save the password (shown once)**. Copy username, host, TLS port.
3. **LiveKit Cloud** → Telephony → SIP trunks → **Outbound**: address = Photon host:port (no `sip:`), transport TLS,
   numbers = Photon number (+1…), media encryption enabled, username/password from step 2. Copy trunk id `ST_…` → `LIVEKIT_SIP_TRUNK_ID`.
4. LiveKit project settings → API keys → `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.
5. Run: `npm run dev` (API) and `npm run agent` (voice worker) in two terminals, `MOCK_CALLS=false`.
6. Test: `curl -X POST localhost:3000/api/alerts/<alert>/people/<person>/contact -H 'content-type: application/json' -d '{"channel":"voice"}'`
   (person's phone in the DB = your test phone, **not** the Photon number).

Inbound (optional): LiveKit inbound trunk + dispatch rule (`photon-` prefix, agent `safenet-caller`), Photon inbound → `sips:<project>.sip.livekit.cloud`.

## Safety (enforced in code, not the model)
- 3 fixed questions first, verbatim. Every caller turn is keyword-scanned; danger → "Please hang up and call 911 now",
  call ends, triage → critical and escalation created **mid-call**.
- Nemotron slow (>3.5 s) or invalid → next scripted question. Acks time out at 1.5 s → "Thank you."
