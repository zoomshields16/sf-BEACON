// All SQL lives here. Column names for the tables the backend writes are ASSUMED
// (db/schema.sql wasn't in the repo when this was written) — if a query fails,
// fix it here and nowhere else.
//
// Assumed columns:
//   agent_log(id, alert_id, person_id, agent, thought, tool, input jsonb, output jsonb, created_at)
//   contact_attempts(id, alert_id, person_id, channel, status, external_id, started_at, ended_at)
//   conversation_history(id, alert_id, person_id, attempt_id, channel, role, content, created_at)
//   triage(alert_id, person_id, status, urgency_score, emergency_type, needs text[], location_in_home, notes, updated_at)
//   escalations(id, alert_id, person_id, kind, reason, payload jsonb, status, created_at, reviewed_at)
import { query } from "./db.js";

export type Id = string | number;
export type Row = Record<string, any>;
export type Channel = "voice" | "sms";

// ---------- SQL functions from db/functions.sql ----------
const DB_FUNCTIONS = new Set([
  "activate_alert",
  "call_queue",
  "person_context",
  "alert_stats",
  "hex_risk",
  "map_people_geojson",
  "map_hex_geojson",
  "simulate_reports",
  "reset_demo",
  "upsert_nws_alert",
  "alerts_overview",
]);

/** Calls a whitelisted SQL function with parameterized args. Unwraps single scalar/json results. */
async function fn(name: string, args: unknown[]): Promise<any> {
  if (!DB_FUNCTIONS.has(name)) throw new Error(`unknown db function: ${name}`);
  const placeholders = args.map((_, i) => `$${i + 1}`).join(", ");
  const rows = await query(`select * from ${name}(${placeholders})`, args);
  if (rows.length === 1) {
    const keys = Object.keys(rows[0]);
    if (keys.length === 1 && keys[0] === name) return rows[0][name];
  }
  return rows;
}

export const activateAlert = (alertId: Id) => fn("activate_alert", [alertId]);
export const resetDemo = (alertId: Id) => fn("reset_demo", [alertId]);
/** All non-ended alerts (demo + NWS) with how many policyholders live inside each. */
export const alertsOverview = async (): Promise<Row[]> => {
  const r = await fn("alerts_overview", []);
  return Array.isArray(r) ? r : [r];
};

export interface NwsAlertInput {
  nwsId: string; eventType: string; headline?: string; description?: string; severity?: string;
  urgency?: string; areaDesc?: string; geometry: unknown; onset?: string | null; expires?: string | null;
}
export const upsertNwsAlert = async (a: NwsAlertInput): Promise<number> =>
  Number(await fn("upsert_nws_alert", [a.nwsId, a.eventType, a.headline ?? null, a.description ?? null, a.severity ?? null,
    a.urgency ?? null, a.areaDesc ?? null, JSON.stringify(a.geometry), a.onset ?? null, a.expires ?? null]));
export const callQueue = (alertId: Id, limit: number): Promise<Row[]> => fn("call_queue", [alertId, limit]);
export const personContext = (personId: Id, alertId: Id): Promise<Row> => fn("person_context", [personId, alertId]);
export const alertStats = async (alertId: Id) => {
  const r = await fn("alert_stats", [alertId]);
  return Array.isArray(r) ? r[0] ?? null : r;
};
export const hexRisk = (alertId: Id): Promise<Row[]> => fn("hex_risk", [alertId]);
export const mapPeople = (alertId: Id) => fn("map_people_geojson", [alertId]);
export const mapHex = (alertId: Id) => fn("map_hex_geojson", [alertId]);
export const simulateReports = (alertId: Id, lon: number, lat: number, radiusM: number, n: number) =>
  fn("simulate_reports", [alertId, lon, lat, radiusM, n]);

// ---------- person_context accessors (tolerant of the exact JSON shape) ----------
function pick(obj: any, paths: string[]): any {
  for (const p of paths) {
    const v = p.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
    if (v != null && v !== "") return v;
  }
  return undefined;
}
export const ctxPhone = (c: Row): string | undefined => pick(c, ["profile.phone", "person.phone", "phone"]);
export const ctxName = (c: Row): string =>
  pick(c, ["profile.first_name", "profile.full_name", "profile.name", "person.name", "name"]) ?? "there";
export const ctxEventType = (c: Row): string =>
  pick(c, ["alert.event_type", "alert.event", "alert.type", "alert.headline"]) ?? "emergency";
export const ctxHistory = (c: Row): Row[] =>
  pick(c, ["history", "conversation_history", "conversation", "contacts"]) ?? [];
export const ctxLocation = (c: Row) => ({
  address: pick(c, ["profile.address", "person.address", "address"]),
  lat: pick(c, ["profile.lat", "profile.latitude", "person.lat", "lat"]),
  lon: pick(c, ["profile.lon", "profile.lng", "profile.longitude", "person.lon", "lon"]),
});

// ---------- agent_log ----------
export interface AgentLogEntry {
  alertId: Id;
  personId?: Id | null;
  agent: "coordinator" | "triage" | "escalation" | "system";
  thought: string;
  tool?: string | null;
  input?: unknown;
  output?: unknown;
}

/** Never throws — logging must not break a call. */
export async function logAgent(e: AgentLogEntry) {
  const line = `[${e.agent}] ${e.tool ? e.tool + ": " : ""}${e.thought}`;
  console.log(line.slice(0, 300));
  try {
    await query(
      `insert into agent_log (alert_id, person_id, agent, thought, tool, input, output)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [e.alertId, e.personId ?? null, e.agent, e.thought.slice(0, 1000), e.tool ?? null,
       JSON.stringify(e.input ?? null), JSON.stringify(e.output ?? null)],
    );
  } catch (err) {
    console.error("agent_log insert failed:", (err as Error).message);
  }
}

export const recentAgentLog = (alertId: Id, afterId: number, limit = 100) =>
  query(
    `select * from agent_log where alert_id = $1 and id > $2 order by id desc limit $3`,
    [alertId, afterId, limit],
  );

// ---------- contact_attempts ----------
export async function insertAttempt(alertId: Id, personId: Id, channel: Channel): Promise<Id> {
  const rows = await query(
    `insert into contact_attempts (alert_id, person_id, channel, status, started_at)
     values ($1, $2, $3, 'in_progress', now()) returning id`,
    [alertId, personId, channel],
  );
  return rows[0].id;
}

export const setAttemptExternalId = (attemptId: Id, externalId: string) =>
  query(`update contact_attempts set external_id = $2 where id = $1`, [attemptId, externalId]);

/** On API start: attempts left 'in_progress' by a crash/restart would block those people forever — close them. */
export const closeOrphanedAttempts = async (): Promise<number> =>
  (await query(`update contact_attempts set status = 'timeout', ended_at = now() where status = 'in_progress' returning id`)).length;

export const finishAttempt = (attemptId: Id, status: string) =>
  query(`update contact_attempts set status = $2, ended_at = now() where id = $1`, [attemptId, status]);

export async function findAttempt(attemptId?: Id | null, externalId?: string | null): Promise<Row | null> {
  const rows = attemptId
    ? await query(`select * from contact_attempts where id = $1`, [attemptId])
    : await query(`select * from contact_attempts where external_id = $1`, [externalId]);
  return rows[0] ?? null;
}

export const latestAttempt = async (alertId: Id, personId: Id) =>
  (await query(
    `select * from contact_attempts where alert_id = $1 and person_id = $2 order by id desc limit 1`,
    [alertId, personId],
  ))[0] ?? null;

/** How many of this person's attempts ended without reaching them (no_answer / failed / timeout / unanswered text).
 *  Same definition the DB uses for call_queue and the exhausted trigger. */
export const countUnreached = async (alertId: Id, personId: Id): Promise<number> =>
  Number((await query(`select failed_attempts($1, $2) as n`, [alertId, personId]))[0]?.n ?? 0);

/** Caller asked us to stop calling — persisted, so call_queue never re-queues them (survives restarts). */
export const setDoNotContact = (alertId: Id, personId: Id) =>
  query(`update triage set do_not_contact = true, updated_at = now() where alert_id = $1 and person_id = $2`, [alertId, personId]);

// ---------- conversation_history ----------
export const addMessage = (
  alertId: Id, personId: Id, attemptId: Id | null, channel: Channel, role: "agent" | "user", content: string,
) =>
  query(
    `insert into conversation_history (alert_id, person_id, attempt_id, channel, role, content)
     values ($1, $2, $3, $4, $5, $6)`,
    [alertId, personId, attemptId, channel, role, content],
  );

// ---------- triage ----------
export interface TriageFields {
  status: "unreached" | "safe" | "needs_help" | "critical" | "exhausted";
  urgency_score: number;
  emergency_type: string | null;
  needs: string[];
  location_in_home: string | null;
  notes: string;
}

export const getTriage = async (alertId: Id, personId: Id) =>
  (await query(`select * from triage where alert_id = $1 and person_id = $2`, [alertId, personId]))[0] ?? null;

export const updateTriage = (alertId: Id, personId: Id, t: TriageFields) =>
  query(
    `update triage set status = $3, urgency_score = $4, emergency_type = $5, needs = $6,
       location_in_home = $7, notes = $8, updated_at = now()
     where alert_id = $1 and person_id = $2`,
    [alertId, personId, t.status, t.urgency_score, t.emergency_type, t.needs, t.location_in_home, t.notes],
  );

// ---------- escalations ----------
/** '911' = life-or-death only (triage critical). Others go to the State Farm responder queue, never 911. */
export type EscalationKind = "911" | "urgent_assist" | "welfare";

export async function createEscalation(
  alertId: Id, personId: Id, reason: string, payload: unknown, kind: EscalationKind = "911",
): Promise<Id> {
  const rows = await query(
    // The phone's last precise location (from the sf-BEACON app) rides along in the payload, separate from the home address.
    `insert into escalations (alert_id, person_id, kind, reason, payload, status)
     values ($1, $2, $3, $4, $5::jsonb || coalesce((select jsonb_build_object('live_location', jsonb_build_object(
               'lat', last_lat, 'lon', last_lng, 'as_of', last_seen)) from policyholders where id = $2 and last_lat is not null), '{}'::jsonb),
             'pending_review') returning id`,
    [alertId, personId, kind, reason, JSON.stringify(payload)],
  );
  return rows[0].id;
}

export const openEscalationFor = async (alertId: Id, personId: Id, kind: EscalationKind = "911") =>
  (await query(
    `select * from escalations where alert_id = $1 and person_id = $2 and kind = $3 and status = 'pending_review' limit 1`,
    [alertId, personId, kind],
  ))[0] ?? null;

export const listEscalations = (alertId: Id) =>
  query(`select * from escalations where alert_id = $1 order by created_at desc`, [alertId]);

export const reviewEscalation = (escalationId: Id, status: "confirmed" | "dismissed") =>
  query(`update escalations set status = $2, reviewed_at = now() where id = $1 returning *`, [escalationId, status]);

// ---------- mobile app (sf-BEACON) ----------
const digits10 = (p: string) => p.replace(/\D/g, "").slice(-10);

/** Policyholder whose phone matches (last 10 digits), or null. */
export const personByPhone = async (phone: string) =>
  digits10(phone).length < 10 ? null : (await query(
    `select id, first_name, last_name, address from policyholders
     where right(regexp_replace(phone, '[^0-9]', '', 'g'), 10) = $1 limit 1`, [digits10(phone)]))[0] ?? null;

/** Active alerts whose polygon contains this person's home, plus their triage status in each. */
export const activeAlertsForPerson = (personId: Id) =>
  query(
    `select a.id, a.event_type, a.headline, a.description, a.area_desc, a.onset, a.expires, a.created_at,
            a.activated_at, t.status as triage_status
     from alerts a
     join policyholders p on p.id = $1 and st_contains(a.geom, p.geom)
     left join triage t on t.alert_id = a.id and t.person_id = p.id
     where a.status = 'active' and (a.expires is null or a.expires > now())
     order by a.activated_at desc nulls last`, [personId]);

export interface Registration {
  name: string; phone: string; address: string; lat: number; lng: number; age?: number | null;
  adults: number; children: number; pets: string | null; needs: string | null; safeRoom?: string | null; pushToken?: string | null;
}
/** Creates the app user as a policyholder (or updates the row that already has this phone). Returns the id. */
export async function registerPerson(r: Registration): Promise<number> {
  const [first, ...rest] = r.name.trim().split(/\s+/);
  const size = Math.min(20, Math.max(1, r.adults + r.children));
  const vals = [first || "Resident", rest.join(" ") || "-", r.phone, r.address, r.lng, r.lat, size, r.age ?? null,
    r.children > 0, r.needs || null, r.pets || null, r.pushToken ?? null];
  const existing = await personByPhone(r.phone);
  const rows = existing
    ? await query(
        `update policyholders set first_name=$1, last_name=$2, phone=$3, address=$4, geom=ST_SetSRID(ST_MakePoint($5,$6),4326),
           household_size=$7, age=coalesce($8, age), has_children=$9, medical_needs=$10, pets=$11, push_token=coalesce($12, push_token)
         where id = $13 returning id`, [...vals, existing.id])
    : await query(
        `insert into policyholders (first_name,last_name,phone,address,geom,household_size,age,has_children,medical_needs,pets,push_token,policy_number)
         values ($1,$2,$3,$4,ST_SetSRID(ST_MakePoint($5,$6),4326),$7,$8,$9,$10,$11,$12,'APP-' || $3) returning id`, vals);
  const id = rows[0].id;
  if (r.safeRoom) await query(
    `insert into saferooms (person_id, location) values ($1,$2) on conflict (person_id) do update set location = excluded.location`, [id, r.safeRoom]);
  return id;
}

export const saveLocation = (personId: Id, lat: number, lng: number) =>
  query(`update policyholders set last_lat=$2, last_lng=$3, last_seen=now() where id=$1`, [personId, lat, lng]);

/** People with the app installed, for the dashboard's "send alert" panel. */
export const appUsers = () =>
  query(`select id, first_name || ' ' || last_name as name, address, ST_Y(geom) as lat, ST_X(geom) as lng
         from policyholders where push_token is not null order by id`);

/** Push tokens of app users whose home is inside the alert. */
export const pushTokensInAlert = async (alertId: Id): Promise<string[]> =>
  (await query(`select p.push_token from policyholders p join alerts a on a.id = $1 and ST_Covers(a.geom, p.geom)
                where p.push_token is not null`, [alertId])).map((r: Row) => r.push_token);

export const endOldDemoAlerts = (keepId: Id) =>
  query(`update alerts set status = 'ended' where nws_id like 'demo-app-%' and id <> $1 and status <> 'ended'`, [keepId]);
