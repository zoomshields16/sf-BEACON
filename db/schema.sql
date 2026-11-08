-- SF-SafeNet schema. Run order: schema.sql → functions.sql → seed.sql
-- Re-runnable: drops and recreates everything (demo database, no migrations).
create extension if not exists postgis;

drop table if exists hazard_reports, alert_hexes, escalations, agent_log, conversation_history,
                     contact_attempts, triage, alerts, saferooms, policyholders cascade;

-- ───────────────────────── people ─────────────────────────
create table policyholders (
  id                serial primary key,
  policy_number     text unique not null,
  first_name        text not null,
  last_name         text not null,
  phone             text not null,                 -- E.164, e.g. +12145550123
  address           text not null,
  geom              geometry(Point, 4326) not null, -- home location
  household_size    int  not null default 1 check (household_size between 1 and 20),
  age               int  check (age between 0 and 120),  -- primary policyholder
  has_children      boolean not null default false,
  has_elderly       boolean not null default false,       -- anyone 70+ in the household
  medical_needs     text,                                 -- e.g. 'oxygen concentrator', 'insulin', 'dialysis'
  mobility_limited  boolean not null default false,
  pets              text,                                 -- e.g. '2 dogs'
  language          text not null default 'en',
  created_at        timestamptz not null default now()
);
create index policyholders_geom_idx on policyholders using gist (geom);
create index policyholders_phone_idx on policyholders (phone);

-- Where the household shelters in place (State Farm "SafeRoom").
create table saferooms (
  person_id     int primary key references policyholders(id) on delete cascade,
  location      text not null,               -- 'upstairs bedroom', 'interior bathroom', 'storm cellar'
  has_supplies  boolean not null default false,
  notes         text
);

-- ───────────────────────── alerts ─────────────────────────
create table alerts (
  id            serial primary key,
  nws_id        text unique,                 -- NWS alert id (null for hand-made demo alerts)
  event_type    text not null,               -- 'Flash Flood Warning', 'Tornado Warning', ...
  headline      text,
  description   text,
  severity      text,                        -- NWS: Extreme / Severe / Moderate / Minor
  urgency       text,                        -- NWS: Immediate / Expected / Future
  area_desc     text,
  geom          geometry(MultiPolygon, 4326) not null,
  onset         timestamptz,
  expires       timestamptz,
  status        text not null default 'pending' check (status in ('pending', 'active', 'ended')),
  activated_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index alerts_geom_idx on alerts using gist (geom);

-- ───────────────────── per-alert state ─────────────────────
-- One row per policyholder inside an active alert (created by activate_alert).
create table triage (
  alert_id          int not null references alerts(id) on delete cascade,
  person_id         int not null references policyholders(id) on delete cascade,
  status            text not null default 'unreached'
                      check (status in ('unreached', 'safe', 'needs_help', 'critical', 'exhausted')),
  urgency_score     int not null default 0 check (urgency_score between 0 and 100),
  emergency_type    text,
  needs             text[] not null default '{}',
  location_in_home  text,
  notes             text not null default '',
  do_not_contact    boolean not null default false,   -- caller asked us to stop calling (never re-queued)
  updated_at        timestamptz not null default now(),
  primary key (alert_id, person_id)
);
create index triage_status_idx on triage (alert_id, status);

create table contact_attempts (
  id           serial primary key,
  alert_id     int not null references alerts(id) on delete cascade,
  person_id    int not null references policyholders(id) on delete cascade,
  channel      text not null check (channel in ('voice', 'sms')),
  -- in_progress → completed | no_answer | failed | timeout   (sms: sent → replied)
  status       text not null default 'in_progress'
                 check (status in ('in_progress', 'completed', 'no_answer', 'failed', 'timeout', 'sent', 'replied')),
  external_id  text,                          -- LiveKit room name / provider call id
  started_at   timestamptz not null default now(),
  ended_at     timestamptz
);
create index contact_attempts_person_idx on contact_attempts (alert_id, person_id);
create index contact_attempts_external_idx on contact_attempts (external_id);

-- Every line said on a call (or texted), in order. Feeds "remember the call".
create table conversation_history (
  id          bigserial primary key,
  alert_id    int not null references alerts(id) on delete cascade,
  person_id   int not null references policyholders(id) on delete cascade,
  attempt_id  int references contact_attempts(id) on delete set null,
  channel     text not null check (channel in ('voice', 'sms')),
  role        text not null check (role in ('agent', 'user')),
  content     text not null,
  created_at  timestamptz not null default now()
);
create index conversation_person_idx on conversation_history (alert_id, person_id, id);

-- Every agent step (thought → tool → input/output) for the live dashboard feed.
create table agent_log (
  id          bigserial primary key,
  alert_id    int not null references alerts(id) on delete cascade,
  person_id   int references policyholders(id) on delete set null,
  agent       text not null check (agent in ('coordinator', 'triage', 'escalation', 'system')),
  thought     text not null,
  tool        text,
  input       jsonb,
  output      jsonb,
  created_at  timestamptz not null default now()
);
create index agent_log_alert_idx on agent_log (alert_id, id);

-- Simulated RapidSOS 911 handoffs; a human confirms before anything is "sent".
create table escalations (
  id           serial primary key,
  alert_id     int not null references alerts(id) on delete cascade,
  person_id    int not null references policyholders(id) on delete cascade,
  reason       text not null,
  payload      jsonb not null,
  status       text not null default 'pending_review' check (status in ('pending_review', 'confirmed', 'dismissed')),
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz
);
create index escalations_alert_idx on escalations (alert_id, status);
-- At most one open escalation per person per alert.
create unique index escalations_one_open_idx on escalations (alert_id, person_id) where status = 'pending_review';

-- ───────────────────── crowdsourced risk ─────────────────────
-- Hexagon grid covering an alert (built by activate_alert).
create table alert_hexes (
  alert_id  int not null references alerts(id) on delete cascade,
  hex_id    text not null,                     -- 'i_j' grid index from ST_HexagonGrid
  geom      geometry(Polygon, 4326) not null,
  primary key (alert_id, hex_id)
);
create index alert_hexes_geom_idx on alert_hexes using gist (geom);

-- Hazard reports: from callers ("water is rising"), crowdsourcing, or the demo simulator.
create table hazard_reports (
  id          bigserial primary key,
  alert_id    int not null references alerts(id) on delete cascade,
  geom        geometry(Point, 4326) not null,
  kind        text not null default 'flooding',   -- flooding, fire, damage, power_out, blocked_road …
  severity    int  not null default 3 check (severity between 1 and 5),
  source      text not null default 'crowd' check (source in ('crowd', 'call', 'simulated')),
  created_at  timestamptz not null default now()
);
create index hazard_reports_geom_idx on hazard_reports using gist (geom);
create index hazard_reports_alert_idx on hazard_reports (alert_id, created_at);
