// All SQL lives here. Column names for the tables the backend writes are ASSUMED
// (db/schema.sql wasn't in the repo when this was written) — if a query fails,
// fix it here and nowhere else.
//
// Assumed columns:
//   agent_log(id, alert_id, person_id, agent, thought, tool, input jsonb, output jsonb, created_at)
//   contact_attempts(id, alert_id, person_id, channel, status, external_id, started_at, ended_at)
//   conversation_history(id, alert_id, person_id, attempt_id, channel, role, content, created_at)
//   triage(alert_id, person_id, status, urgency_score, emergency_type, needs text[], location_in_home, notes, updated_at)
//   escalations(id, alert_id, person_id, reason, payload jsonb, status, created_at, reviewed_at)
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

/** How many of this person's call attempts ended without reaching them. */
export const countUnreached = async (alertId: Id, personId: Id): Promise<number> =>
  Number((await query(
    `select count(*) as n from contact_attempts where alert_id = $1 and person_id = $2 and status = 'no_answer'`,
    [alertId, personId],
  ))[0]?.n ?? 0);

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
  status: "unreached" | "safe" | "needs_help" | "critical";
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
export async function createEscalation(alertId: Id, personId: Id, reason: string, payload: unknown): Promise<Id> {
  const rows = await query(
    `insert into escalations (alert_id, person_id, reason, payload, status)
     values ($1, $2, $3, $4, 'pending_review') returning id`,
    [alertId, personId, reason, JSON.stringify(payload)],
  );
  return rows[0].id;
}

export const openEscalationFor = async (alertId: Id, personId: Id) =>
  (await query(
    `select * from escalations where alert_id = $1 and person_id = $2 and status = 'pending_review' limit 1`,
    [alertId, personId],
  ))[0] ?? null;

export const listEscalations = (alertId: Id) =>
  query(`select * from escalations where alert_id = $1 order by created_at desc`, [alertId]);

export const reviewEscalation = (escalationId: Id, status: "confirmed" | "dismissed") =>
  query(`update escalations set status = $2, reviewed_at = now() where id = $1 returning *`, [escalationId, status]);
