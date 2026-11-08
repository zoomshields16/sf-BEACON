-- sf-BEACON query functions. The backend calls these through src/repo.ts.
-- Tunables live in safenet_setting() so they're easy to find.

create or replace function safenet_setting(key text) returns numeric language sql immutable as $$
  select case key
    when 'max_attempts'      then 4      -- unanswered calls before a person is "exhausted"
    when 'retry_after_sec'   then 120    -- wait between attempts to the same person
    when 'hex_size_m'        then 600    -- hexagon edge length for the risk grid
    when 'report_window_hr'  then 6      -- hazard reports older than this stop counting
  end
$$;

-- ───────────────────────── alerts ─────────────────────────

-- Ingest/refresh an NWS alert from its GeoJSON geometry (Polygon or MultiPolygon). Returns alert id.
create or replace function upsert_nws_alert(
  p_nws_id text, p_event_type text, p_headline text, p_description text, p_severity text,
  p_urgency text, p_area_desc text, p_geometry jsonb, p_onset timestamptz, p_expires timestamptz
) returns int language sql as $$
  insert into alerts (nws_id, event_type, headline, description, severity, urgency, area_desc, geom, onset, expires)
  values (p_nws_id, p_event_type, p_headline, p_description, p_severity, p_urgency, p_area_desc,
          ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(p_geometry::text), 4326)), p_onset, p_expires)
  on conflict (nws_id) do update set
    event_type = excluded.event_type, headline = excluded.headline, description = excluded.description,
    severity = excluded.severity, urgency = excluded.urgency, area_desc = excluded.area_desc,
    geom = excluded.geom, onset = excluded.onset, expires = excluded.expires
  returning id
$$;

-- Alert picker for the dashboard: every non-ended alert with how many policyholders live inside it.
-- Expired NWS alerts are ended first (the hand-made demo alert never expires).
create or replace function alerts_overview()
returns table (id int, nws_id text, event_type text, headline text, severity text, urgency text, area_desc text,
               status text, expires timestamptz, source text, people_inside int)
language plpgsql as $$
begin
  update alerts a set status = 'ended'
  where a.status = 'pending' and a.expires < now() and a.nws_id not like 'demo-%';

  return query
  select a.id, a.nws_id, a.event_type, a.headline, a.severity, a.urgency, a.area_desc, a.status, a.expires,
         case when a.nws_id like 'demo-%' then 'demo' else 'nws' end,
         (select count(*) from policyholders p where ST_Covers(a.geom, p.geom))::int
  from alerts a
  where a.status <> 'ended'
  order by (a.status = 'active') desc, 11 desc, a.id;
end $$;

-- Start an alert: mark active, create an 'unreached' triage row for everyone inside it,
-- and build the hexagon risk grid. Safe to call twice.
create or replace function activate_alert(p_alert_id int) returns jsonb language plpgsql as $$
declare
  v_people int;
  v_hexes  int;
begin
  update alerts set status = 'active', activated_at = coalesce(activated_at, now()) where id = p_alert_id;
  if not found then raise exception 'alert % not found', p_alert_id; end if;

  insert into triage (alert_id, person_id)
  select p_alert_id, p.id
  from policyholders p join alerts a on a.id = p_alert_id
  where ST_Covers(a.geom, p.geom)
  on conflict do nothing;
  select count(*) into v_people from triage where alert_id = p_alert_id;

  -- Hex grid in Web Mercator (meters), stored back as lon/lat.
  insert into alert_hexes (alert_id, hex_id, geom)
  select p_alert_id, h.i || '_' || h.j, ST_Transform(h.geom, 4326)
  from alerts a,
       ST_HexagonGrid(safenet_setting('hex_size_m'), ST_Transform(a.geom, 3857)) h
  where a.id = p_alert_id and ST_Intersects(ST_Transform(a.geom, 3857), h.geom)
  on conflict do nothing;
  select count(*) into v_hexes from alert_hexes where alert_id = p_alert_id;

  return jsonb_build_object('alert_id', p_alert_id, 'people', v_people, 'hexes', v_hexes);
end $$;

-- Demo helper: wipe all per-alert activity so the demo can be run again.
create or replace function reset_demo(p_alert_id int) returns jsonb language plpgsql as $$
begin
  delete from escalations          where alert_id = p_alert_id;
  delete from agent_log            where alert_id = p_alert_id;
  delete from conversation_history where alert_id = p_alert_id;
  delete from contact_attempts     where alert_id = p_alert_id;
  delete from hazard_reports       where alert_id = p_alert_id;
  delete from triage               where alert_id = p_alert_id;
  delete from alert_hexes          where alert_id = p_alert_id;
  update alerts set status = 'pending', activated_at = null where id = p_alert_id;
  return jsonb_build_object('alert_id', p_alert_id, 'reset', true);
end $$;

-- ───────────────────────── risk ─────────────────────────

-- Crowdsourced risk per hexagon, 0..1. Combines recent hazard reports with triage outcomes inside the hex.
create or replace function hex_risk(p_alert_id int)
returns table (hex_id text, risk numeric, reports int, critical int, needs_help int, people int)
language sql stable as $$
  with rep as (
    select h.hex_id, count(r.*)::int as n, coalesce(sum(r.severity), 0) as sev
    from alert_hexes h
    left join hazard_reports r
      on r.alert_id = h.alert_id and ST_Covers(h.geom, r.geom)
     and r.created_at > now() - make_interval(hours => safenet_setting('report_window_hr')::int)
    where h.alert_id = p_alert_id
    group by h.hex_id
  ), ppl as (
    select h.hex_id,
           count(t.*)::int                                    as people,
           count(*) filter (where t.status = 'critical')::int   as critical,
           count(*) filter (where t.status = 'needs_help')::int as needs_help
    from alert_hexes h
    left join policyholders p on ST_Covers(h.geom, p.geom)
    left join triage t on t.person_id = p.id and t.alert_id = h.alert_id
    where h.alert_id = p_alert_id
    group by h.hex_id
  )
  select rep.hex_id,
         round(least(1.0, rep.sev / 20.0 + ppl.critical * 0.25 + ppl.needs_help * 0.08)::numeric, 3) as risk,
         rep.n, ppl.critical, ppl.needs_help, ppl.people
  from rep join ppl using (hex_id)
  order by risk desc
$$;

-- Demo only: drop n hazard reports at random points within radius_m of (lon, lat).
create or replace function simulate_reports(p_alert_id int, p_lon float8, p_lat float8, p_radius_m float8, p_n int)
returns int language sql as $$
  with ins as (
    insert into hazard_reports (alert_id, geom, kind, severity, source)
    select p_alert_id,
           ST_Project(ST_SetSRID(ST_MakePoint(p_lon, p_lat), 4326)::geography,
                      p_radius_m * sqrt(random()), radians(random() * 360))::geometry,
           (array['flooding', 'flooding', 'flooding', 'blocked_road', 'power_out'])[1 + floor(random() * 5)::int],
           3 + floor(random() * 3)::int,
           'simulated'
    from generate_series(1, p_n)
    returning 1
  )
  select count(*)::int from ins
$$;

-- ───────────────────────── contact queue ─────────────────────────

-- Unanswered attempts for one person in one alert: calls that ended no_answer / failed / timeout, plus texts that
-- were sent but never replied to (a reply flips 'sent' → 'replied').
create or replace function failed_attempts(p_alert_id int, p_person_id int) returns int language sql stable as $$
  select count(*)::int from contact_attempts
  where alert_id = p_alert_id and person_id = p_person_id and status in ('no_answer', 'failed', 'timeout', 'sent')
$$;

-- Next people to contact, most urgent first. Only people not yet reached, not already on a call,
-- not exhausted, and past the retry wait. `reasons` explains the priority to the coordinator agent.
-- next_channel: voice for the first 2 attempts, then sms (the backend turns sms into voice while texts are off).
create or replace function call_queue(p_alert_id int, p_limit int)
returns table (person_id int, name text, phone text, priority numeric, next_channel text,
               attempts int, hex_risk numeric, reasons text[])
language sql stable as $$
  with risk as (select * from hex_risk(p_alert_id)),
  cand as (
    select p.*, t.status,
           failed_attempts(p_alert_id, p.id) as fails,
           coalesce((select r.risk from alert_hexes h join risk r using (hex_id)
                     where h.alert_id = p_alert_id and ST_Covers(h.geom, p.geom) limit 1), 0) as hrisk,
           (select max(coalesce(c.ended_at, c.started_at)) from contact_attempts c
             where c.alert_id = p_alert_id and c.person_id = p.id) as last_try
    from triage t join policyholders p on p.id = t.person_id
    where t.alert_id = p_alert_id and t.status = 'unreached' and not t.do_not_contact
      and not exists (select 1 from contact_attempts c
                      where c.alert_id = p_alert_id and c.person_id = p.id and c.status = 'in_progress')
  )
  select id, first_name || ' ' || last_name, phone,
         round((10
           + case when medical_needs is not null then 30 else 0 end
           + case when mobility_limited then 20 else 0 end
           + case when coalesce(age, 0) >= 70 or has_elderly then 25 else 0 end
           + case when has_children then 10 else 0 end
           + least(household_size, 6) * 2
           + hrisk * 40
           - fails * 5)::numeric, 1) as priority,
         case when fails >= 2 then 'sms' else 'voice' end,
         fails, hrisk,
         array_remove(array[
           case when medical_needs is not null then 'medical: ' || medical_needs end,
           case when mobility_limited then 'limited mobility' end,
           case when coalesce(age, 0) >= 70 or has_elderly then 'elderly household' end,
           case when has_children then 'children in home' end,
           case when hrisk >= 0.5 then 'high-risk area' end,
           case when fails > 0 then fails || ' unanswered attempt(s)' end
         ], null)
  from cand
  where fails < safenet_setting('max_attempts')
    and (last_try is null or last_try < now() - make_interval(secs => safenet_setting('retry_after_sec')))
  order by priority desc, id
  limit p_limit
$$;

-- After enough unanswered attempts, mark the person exhausted so responders see who we couldn't reach.
create or replace function mark_exhausted() returns trigger language plpgsql as $$
begin
  if new.status in ('no_answer', 'failed', 'timeout')
     and failed_attempts(new.alert_id, new.person_id) >= safenet_setting('max_attempts') then
    update triage set status = 'exhausted', updated_at = now(),
                      notes = 'No answer after ' || safenet_setting('max_attempts') || ' attempts'
    where alert_id = new.alert_id and person_id = new.person_id and status = 'unreached';
  end if;
  return new;
end $$;
drop trigger if exists contact_attempts_exhausted on contact_attempts;
create trigger contact_attempts_exhausted after update of status on contact_attempts
  for each row execute function mark_exhausted();

-- A critical/needs-help call is also a hazard report at the caller's home (feeds hex risk → coordinator re-plans).
create or replace function triage_to_report() returns trigger language plpgsql as $$
begin
  if new.status in ('critical', 'needs_help') and new.status is distinct from old.status then
    insert into hazard_reports (alert_id, geom, kind, severity, source)
    select new.alert_id, p.geom, coalesce(new.emergency_type, 'reported_by_call'),
           case when new.status = 'critical' then 5 else 3 end, 'call'
    from policyholders p where p.id = new.person_id;
  end if;
  return new;
end $$;
drop trigger if exists triage_hazard_report on triage;
create trigger triage_hazard_report after update of status on triage
  for each row execute function triage_to_report();

-- ───────────────────────── context for the agents ─────────────────────────

-- Everything the agents need about one person in one alert (profile, SafeRoom, alert, triage, attempts, history).
create or replace function person_context(p_person_id int, p_alert_id int) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'profile', jsonb_build_object(
      'id', p.id, 'policy_number', p.policy_number, 'first_name', p.first_name, 'last_name', p.last_name,
      'name', p.first_name || ' ' || p.last_name, 'phone', p.phone, 'address', p.address,
      'lat', ST_Y(p.geom), 'lon', ST_X(p.geom), 'household_size', p.household_size, 'age', p.age,
      'has_children', p.has_children, 'has_elderly', p.has_elderly, 'medical_needs', p.medical_needs,
      'mobility_limited', p.mobility_limited, 'pets', p.pets, 'language', p.language),
    'saferoom', (select to_jsonb(s) - 'person_id' from saferooms s where s.person_id = p.id),
    'alert', (select jsonb_build_object('id', a.id, 'event_type', a.event_type, 'headline', a.headline,
                                        'severity', a.severity, 'urgency', a.urgency, 'expires', a.expires)
              from alerts a where a.id = p_alert_id),
    'triage', (select to_jsonb(t) - 'alert_id' - 'person_id' from triage t
               where t.alert_id = p_alert_id and t.person_id = p.id),
    'attempts', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'channel', c.channel, 'status', c.status,
                                                              'started_at', c.started_at, 'ended_at', c.ended_at) order by c.id)
                          from contact_attempts c where c.alert_id = p_alert_id and c.person_id = p.id), '[]'),
    'history', coalesce((select jsonb_agg(jsonb_build_object('channel', h.channel, 'role', h.role,
                                                             'content', h.content, 'created_at', h.created_at) order by h.id)
                         from conversation_history h where h.alert_id = p_alert_id and h.person_id = p.id), '[]')
  )
  from policyholders p where p.id = p_person_id
$$;

-- ───────────────────────── dashboard ─────────────────────────

create or replace function alert_stats(p_alert_id int) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'total',      count(*),
    'unreached',  count(*) filter (where t.status = 'unreached'),
    'safe',       count(*) filter (where t.status = 'safe'),
    'needs_help', count(*) filter (where t.status = 'needs_help'),
    'critical',   count(*) filter (where t.status = 'critical'),
    'exhausted',  count(*) filter (where t.status = 'exhausted'),
    'do_not_contact', count(*) filter (where t.do_not_contact),
    'on_call_now', (select count(*) from contact_attempts c where c.alert_id = p_alert_id and c.status = 'in_progress'),
    'attempts',    (select count(*) from contact_attempts c where c.alert_id = p_alert_id),
    'high_risk_hexes', (select count(*) from hex_risk(p_alert_id) r where r.risk >= 0.5),
    'escalations_pending', (select count(*) from escalations e where e.alert_id = p_alert_id and e.status = 'pending_review' and e.kind = '911'),
    'assist_pending',      (select count(*) from escalations e where e.alert_id = p_alert_id and e.status = 'pending_review' and e.kind <> '911')
  )
  from triage t where t.alert_id = p_alert_id
$$;

create or replace function map_people_geojson(p_alert_id int) returns jsonb language sql stable as $$
  select jsonb_build_object('type', 'FeatureCollection', 'features', coalesce(jsonb_agg(jsonb_build_object(
    'type', 'Feature',
    'geometry', ST_AsGeoJSON(p.geom)::jsonb,
    'properties', jsonb_build_object(
      'person_id', p.id, 'name', p.first_name || ' ' || p.last_name, 'status', t.status,
      'urgency_score', t.urgency_score, 'attempts', failed_attempts(p_alert_id, p.id),
      'do_not_contact', t.do_not_contact,
      'on_call', exists (select 1 from contact_attempts c where c.alert_id = p_alert_id
                                                       and c.person_id = p.id and c.status = 'in_progress'))
  )), '[]'))
  from triage t join policyholders p on p.id = t.person_id
  where t.alert_id = p_alert_id
$$;

create or replace function map_hex_geojson(p_alert_id int) returns jsonb language sql stable as $$
  select jsonb_build_object('type', 'FeatureCollection', 'features', coalesce(jsonb_agg(jsonb_build_object(
    'type', 'Feature',
    'geometry', ST_AsGeoJSON(h.geom)::jsonb,
    'properties', jsonb_build_object('hex_id', h.hex_id, 'risk', r.risk, 'reports', r.reports,
                                     'critical', r.critical, 'people', r.people)
  )), '[]'))
  from alert_hexes h join hex_risk(p_alert_id) r using (hex_id)
  where h.alert_id = p_alert_id
$$;
