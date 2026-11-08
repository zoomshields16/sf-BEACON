-- Demo data: a Flash Flood Warning over SW Houston (Braes Bayou), 1,500 policyholders inside, 100 outside.
-- Deterministic (setseed), so every teammate gets the same people. Re-run after schema.sql.
select setseed(0.42);

-- ───────────── alert 1: Flash Flood Warning ─────────────
insert into alerts (id, nws_id, event_type, headline, description, severity, urgency, area_desc, geom, onset, expires)
values (1, 'demo-ffw-houston-1', 'Flash Flood Warning',
  'Flash Flood Warning for Harris County until 11:00 PM CST',
  'Heavy rain has caused Braes Bayou to overflow. Flash flooding is ongoing or expected to begin shortly in Meyerland, Bellaire and Westbury. Move to higher ground now.',
  'Severe', 'Immediate', 'Harris, TX',
  ST_Multi(ST_GeomFromText('POLYGON((
    -95.505 29.712, -95.470 29.722, -95.440 29.716, -95.410 29.724, -95.385 29.716,
    -95.372 29.700, -95.382 29.680, -95.410 29.668, -95.445 29.664, -95.480 29.670,
    -95.506 29.686, -95.505 29.712))', 4326)),
  now() - interval '30 minutes', now() + interval '48 hours');  -- outlives the hackathon
select setval('alerts_id_seq', (select max(id) from alerts));

-- ───────────── policyholders ─────────────
create temp table _names as select
  array['Maria','James','Linda','Robert','Aisha','Wei','Carlos','Patricia','Daniel','Grace','Tomas','Nina',
        'Harold','Priya','Luis','Ruth','Kevin','Fatima','Marcus','Elena','Samuel','Joy','Andre','Mei',
        'Dorothy','Hector','Leah','Victor','Imani','Frank','Sofia','Omar','Hannah','Jamal','Lucia','Ethan',
        'Keisha','Raj','Ana','Brian','Yolanda','Minh','Rosa','Tyrone','Ingrid','Diego','Naomi','Arthur']   as first,
  array['Garcia','Nguyen','Johnson','Patel','Williams','Okafor','Kim','Hernandez','Brown','Lopez',
        'Davis','Chen','Martinez','Thompson','Ali','Robinson','Tran','Wilson','Moore','Jackson',
        'Rodriguez','Le','Anderson','Taylor','Gonzalez','Harris','Clark','Ramirez','Lewis','Walker',
        'Hall','Young','Allen','Shah','Wright','Scott','Flores','Green','Adams','Baker']             as last,
  array['Braes Blvd','S Rice Ave','Chimney Rock Rd','Beechnut St','N Braeswood Blvd','S Braeswood Blvd',
        'Hillcroft Ave','Fondren Rd','Bissonnet St','Renwick Dr','Stella Link Rd','Jason St']    as street,
  array['oxygen concentrator','insulin','dialysis','CPAP machine','wheelchair user','home nurse visits'] as medical,
  array['1 dog','2 dogs','1 cat','2 cats','dog and cat']                                  as pets;

-- 1,500 inside the alert ("the worst day, at scale") + 100 just outside (to show the polygon filter works).
create temp table _pts as
  select row_number() over () as n, geom, inside from (
    select (ST_Dump(ST_GeneratePoints(geom, 1500, 7))).geom as geom, true as inside
    from alerts where id = 1
    union all
    select (ST_Dump(ST_GeneratePoints(
              ST_Difference(ST_Buffer(geom::geography, 2500)::geometry, geom), 100, 11))).geom, false
    from alerts where id = 1
  ) s;

insert into policyholders (policy_number, first_name, last_name, phone, address, geom, household_size, age,
                           has_children, has_elderly, medical_needs, mobility_limited, pets, language)
select
  'SF-' || lpad((480000 + n)::text, 7, '0'),
  first[1 + floor(random() * array_length(first, 1))::int],
  last[1 + floor(random() * array_length(last, 1))::int],
  '+1555' || lpad((2000000 + n)::text, 7, '0'),          -- fake 555 numbers: never dialed for real
  (2000 + floor(random() * 8000))::int || ' ' || street[1 + n % array_length(street, 1)] || ', Houston, TX',
  geom,
  1 + floor(random() * 5)::int,
  age,
  random() < 0.30,
  age >= 70 or random() < 0.12,
  case when random() < (case when age >= 70 then 0.45 else 0.10 end)
       then medical[1 + floor(random() * array_length(medical, 1))::int] end,
  age >= 85 or random() < 0.05,
  case when random() < 0.4 then pets[1 + floor(random() * array_length(pets, 1))::int] end,
  case when random() < 0.15 then 'es' else 'en' end
-- Adult ages 22–94, skewed younger (~15% are 70+, like a real neighborhood). "+ 0 * n" makes it per-row.
from _pts, _names, lateral (select (22 + floor(power(random(), 2.4) * 73))::int + 0 * n as age) a
order by n;

-- ───────────── team demo people ─────────────
-- Placeholder 555 numbers here (never dialed). `npm run db:setup` swaps in the real team phones from
-- DEMO_PHONES in .env, so real numbers never live in git. Placed near the bayou so they rank high in the queue.
insert into policyholders (policy_number, first_name, last_name, phone, address, geom, household_size, age,
                           has_children, has_elderly, medical_needs, mobility_limited, pets)
values
  ('SF-0490001', 'Zoom', 'Shields', '+15550100001', '4800 N Braeswood Blvd, Houston, TX',
   ST_SetSRID(ST_MakePoint(-95.452, 29.690), 4326), 3, 74, false, true, 'oxygen concentrator', true, '1 dog'),
  ('SF-0490002', 'Peyton', 'Demo', '+15550100002', '5200 Braesvalley Dr, Houston, TX',
   ST_SetSRID(ST_MakePoint(-95.468, 29.684), 4326), 2, 81, false, true, 'dialysis', true, null);

-- ───────────── SafeRooms (~60% of households) ─────────────
insert into saferooms (person_id, location, has_supplies, notes)
select id,
       (array['upstairs bedroom','interior bathroom','second-floor closet','attic room','upstairs hallway'])
         [1 + floor(random() * 5)::int],
       random() < 0.6,
       case when random() < 0.3 then 'Go-bag by the stairs' end
from policyholders
where random() < 0.6 or policy_number in ('SF-0490001', 'SF-0490002');

drop table _names, _pts;
