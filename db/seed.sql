-- Demo data: a Flash Flood Warning over SW Houston (Braes Bayou), ~180 policyholders inside, 20 outside.
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
  now() - interval '30 minutes', now() + interval '6 hours');
select setval('alerts_id_seq', (select max(id) from alerts));

-- ───────────── policyholders ─────────────
create temp table _names as select
  array['Maria','James','Linda','Robert','Aisha','Wei','Carlos','Patricia','Daniel','Grace','Tomas','Nina',
        'Harold','Priya','Luis','Ruth','Kevin','Fatima','Marcus','Elena','Samuel','Joy','Andre','Mei',
        'Dorothy','Hector','Leah','Victor','Imani','Frank']                          as first,
  array['Garcia','Nguyen','Johnson','Patel','Williams','Okafor','Kim','Hernandez','Brown','Lopez',
        'Davis','Chen','Martinez','Thompson','Ali','Robinson','Tran','Wilson','Moore','Jackson']  as last,
  array['Braes Blvd','S Rice Ave','Chimney Rock Rd','Beechnut St','N Braeswood Blvd','S Braeswood Blvd',
        'Hillcroft Ave','Fondren Rd','Bissonnet St','Renwick Dr','Stella Link Rd','Jason St']    as street,
  array['oxygen concentrator','insulin','dialysis','CPAP machine','wheelchair user','home nurse visits'] as medical,
  array['1 dog','2 dogs','1 cat','2 cats','dog and cat']                                  as pets;

-- 180 inside the alert + 20 just outside (to show the polygon filter works).
create temp table _pts as
  select row_number() over () as n, geom, inside from (
    select (ST_Dump(ST_GeneratePoints(geom, 180, 7))).geom as geom, true as inside
    from alerts where id = 1
    union all
    select (ST_Dump(ST_GeneratePoints(
              ST_Difference(ST_Buffer(geom::geography, 2500)::geometry, geom), 20, 11))).geom, false
    from alerts where id = 1
  ) s;

insert into policyholders (policy_number, first_name, last_name, phone, address, geom, household_size, age,
                           has_children, has_elderly, medical_needs, mobility_limited, pets, language)
select
  'SF-' || lpad((480000 + n)::text, 7, '0'),
  first[1 + (n * 7) % array_length(first, 1)],
  last[1 + (n * 13) % array_length(last, 1)],
  '+1555' || lpad((2000000 + n)::text, 7, '0'),          -- fake 555 numbers: never dialed for real
  (2000 + floor(random() * 8000))::int || ' ' || street[1 + n % array_length(street, 1)] || ', Houston, TX',
  geom,
  1 + floor(random() * 5)::int,
  age,
  random() < 0.30,
  age >= 70 or random() < 0.12,
  case when random() < (case when age >= 70 then 0.45 else 0.10 end)
       then medical[1 + floor(random() * array_length(medical, 1))::int] end,
  age >= 80 or random() < 0.06,
  case when random() < 0.4 then pets[1 + floor(random() * array_length(pets, 1))::int] end,
  case when random() < 0.15 then 'es' else 'en' end
from _pts, _names, lateral (select (22 + floor(random() * 70))::int + 0 * n as age) a  -- "+ 0 * n" makes it per-row
order by n;

-- ───────────── demo people with REAL phones (these are the only numbers ever dialed) ─────────────
-- Placed inside the alert near the bayou so they rank high in the call queue.
insert into policyholders (policy_number, first_name, last_name, phone, address, geom, household_size, age,
                           has_children, has_elderly, medical_needs, mobility_limited, pets)
values
  ('SF-0490001', 'Zoom', 'Shields', '+15550100001', '4800 N Braeswood Blvd, Houston, TX',
   ST_SetSRID(ST_MakePoint(-95.452, 29.690), 4326), 3, 74, false, true, 'oxygen concentrator', true, '1 dog');
  -- Peyton: uncomment and add his number
  -- ,('SF-0490002', 'Peyton', '<last>', '+1XXXXXXXXXX', '5200 Braesvalley Dr, Houston, TX',
  --   ST_SetSRID(ST_MakePoint(-95.468, 29.684), 4326), 2, 81, false, true, 'dialysis', true, null);

-- ───────────── SafeRooms (~60% of households) ─────────────
insert into saferooms (person_id, location, has_supplies, notes)
select id,
       (array['upstairs bedroom','interior bathroom','second-floor closet','attic room','upstairs hallway'])
         [1 + floor(random() * 5)::int],
       random() < 0.6,
       case when random() < 0.3 then 'Go-bag by the stairs' end
from policyholders
where random() < 0.6 or phone = '+15550100001';

drop table _names, _pts;
