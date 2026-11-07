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
