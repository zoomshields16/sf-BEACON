-- Database tests. Run after schema → functions → seed:  npm run test:db
-- Any failed check raises an exception (psql exits non-zero → CI fails).
do $$
declare
  v jsonb;
  n int;
  inside int;
  zoom int;
  before numeric;
  after numeric;
begin
  perform reset_demo(1);
  select count(*) into inside from policyholders p, alerts a where a.id = 1 and ST_Covers(a.geom, p.geom);
  assert inside >= 1000, format('seed should put 1000+ people in the alert, got %s', inside);
  assert (select count(*) from policyholders) > inside, 'seed should also have people outside the alert';

  -- activation picks up exactly the people inside the polygon
  v := activate_alert(1);
  assert (v->>'people')::int = inside, format('expected %s people in alert, got %s', inside, v->>'people');
  assert (v->>'hexes')::int > 50, 'hex grid not built';
  select count(*) into n from triage t join policyholders p on p.id = t.person_id
   where t.alert_id = 1 and not ST_Covers((select geom from alerts where id = 1), p.geom);
  assert n = 0, 'someone outside the alert got a triage row';
  perform activate_alert(1);  -- idempotent
  assert (select count(*) from triage where alert_id = 1) = inside, 'activate_alert is not idempotent';

  -- call queue: ordered by priority, every row explains itself
  select count(*) into n from call_queue(1, 5000);
  assert n = inside, format('queue should hold all %s unreached, got %s', inside, n);
  assert (select bool_and(array_length(reasons, 1) is not null or priority < 30) from call_queue(1, 5000)),
         'high-priority people must have reasons';

  -- flood reports near a person push them up the queue
  select id into zoom from policyholders where phone = '+15550100001';
  select priority into before from call_queue(1, 5000) where person_id = zoom;
  perform simulate_reports(1, -95.452, 29.690, 700, 25);
  select priority into after from call_queue(1, 5000) where person_id = zoom;
  assert after > before, format('hazard reports did not raise priority (%s → %s)', before, after);
  assert (select person_id from call_queue(1, 1)) = zoom, 'demo person should be #1 after nearby flood reports';

  -- someone on a call is not queued twice
  insert into contact_attempts (alert_id, person_id, channel) values (1, zoom, 'voice');
  assert not exists (select 1 from call_queue(1, 5000) where person_id = zoom), 'person on a live call is still queued';

  -- 4 unanswered attempts → exhausted (trigger)
  update contact_attempts set status = 'no_answer', ended_at = now() where person_id = zoom;
  insert into contact_attempts (alert_id, person_id, channel, status) select 1, zoom, 'voice', 'in_progress' from generate_series(1, 3);
  update contact_attempts set status = 'no_answer', ended_at = now() where person_id = zoom and status = 'in_progress';
  assert (select status from triage where alert_id = 1 and person_id = zoom) = 'exhausted', 'not exhausted after 4 no-answers';

  -- a critical outcome becomes a hazard report (trigger)
  select count(*) into n from hazard_reports where source = 'call';
  update triage set status = 'critical', urgency_score = 95 where alert_id = 1 and person_id = 1;
  assert (select count(*) from hazard_reports where source = 'call') = n + 1, 'critical triage did not create a hazard report';

  -- opt-out (do_not_contact) is never re-queued
  update triage set do_not_contact = true where alert_id = 1 and person_id = 2;
  assert not exists (select 1 from call_queue(1, 5000) where person_id = 2), 'do_not_contact person is still queued';
  assert (alert_stats(1)->>'do_not_contact')::int = 1, 'alert_stats do_not_contact count wrong';

  -- one open escalation of each kind per person (a person can have an assist request AND a 911 case)
  insert into escalations (alert_id, person_id, reason, payload) values (1, 1, 'test', '{}');
  begin
    insert into escalations (alert_id, person_id, reason, payload) values (1, 1, 'dup', '{}');
    assert false, 'duplicate open escalation was allowed';
  exception when unique_violation then null;
  end;
  insert into escalations (alert_id, person_id, kind, reason, payload) values (1, 1, 'urgent_assist', 'insulin', '{}');
  assert (alert_stats(1)->>'escalations_pending')::int = 1 and (alert_stats(1)->>'assist_pending')::int = 1,
         'alert_stats must count 911 and assistance separately';

  -- context + dashboard shapes the backend relies on
  v := person_context(zoom, 1);
  assert v ? 'profile' and v ? 'history' and v ? 'triage' and v ? 'alert', 'person_context missing keys';
  assert v->'profile'->>'phone' = '+15550100001', 'person_context phone wrong';
  v := alert_stats(1);
  assert (v->>'total')::int = inside and (v->>'critical')::int = 1 and (v->>'exhausted')::int = 1, format('alert_stats wrong: %s', v);
  assert jsonb_array_length(map_people_geojson(1)->'features') = inside, 'people GeoJSON count wrong';
  assert jsonb_array_length(map_hex_geojson(1)->'features') > 50, 'hex GeoJSON empty';

  -- NWS ingest upserts by id
  n := upsert_nws_alert('test-nws-1', 'Tornado Warning', 'h', 'd', 'Extreme', 'Immediate', 'Dallas, TX',
         '{"type":"Polygon","coordinates":[[[-96.9,32.7],[-96.7,32.7],[-96.7,32.9],[-96.9,32.7]]]}', now(), now() + interval '1 hour');
  assert upsert_nws_alert('test-nws-1', 'Tornado Warning', 'h2', 'd', 'Extreme', 'Immediate', 'Dallas, TX',
         '{"type":"Polygon","coordinates":[[[-96.9,32.7],[-96.7,32.7],[-96.7,32.9],[-96.9,32.7]]]}', now(), now() + interval '1 hour') = n, 'upsert created a duplicate';
  -- overview: the demo alert lists its people; the Dallas test alert has none of our (Houston) policyholders
  assert (select people_inside from alerts_overview() where nws_id = 'demo-ffw-houston-1') = inside, 'overview count wrong for demo alert';
  assert (select people_inside from alerts_overview() where nws_id = 'test-nws-1') = 0, 'Dallas alert should cover nobody';
  assert (select source from alerts_overview() where nws_id = 'test-nws-1') = 'nws', 'NWS alert source wrong';
  delete from alerts where nws_id = 'test-nws-1';

  -- reset wipes everything for the demo
  perform reset_demo(1);
  assert (select count(*) from triage where alert_id = 1) = 0 and (select count(*) from contact_attempts where alert_id = 1) = 0, 'reset_demo left data behind';

  raise notice 'db tests: all passed';
end $$;
