import { mockRequest } from "./mock";

export const MOCK = new URLSearchParams(location.search).has("mock");

export type Json = any;
export type Status = "unreached" | "safe" | "needs_help" | "critical" | "exhausted";

export interface LogEntry {
  id: number;
  agent: string;
  thought: string;
  tool: string | null;
  input: Json;
  output: Json;
  person_id: string | number | null;
  created_at: string;
}

export interface AlertSummary {
  id: number;
  nws_id: string | null;
  event_type: string;
  headline: string | null;
  severity: string | null;
  area_desc: string | null;
  status: "pending" | "active" | "ended";
  expires: string | null;
  source: "demo" | "nws";
  people_inside: number;
}

export interface Escalation {
  id: number;
  kind?: "911" | "urgent_assist" | "welfare";
  person_id: string | number;
  reason: string;
  status: "pending_review" | "confirmed" | "dismissed";
  payload: Json;
  created_at: string;
}

async function request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
  if (MOCK) return mockRequest(method, path, body) as T;
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

const get = <T>(p: string) => request<T>("GET", p);
const post = <T>(p: string, b?: unknown) => request<T>("POST", p, b ?? {});

export const api = {
  alerts: () => get<AlertSummary[]>(`/api/alerts`),
  nwsSync: () => post<{ fetched: number; stored: unknown[]; alerts: AlertSummary[] }>(`/api/alerts/nws/sync`),
  health: () => get<{ ok: boolean; db: boolean; mock: boolean; nemotron: boolean }>("/health"),
  stats: (a: string) => get<Json>(`/api/alerts/${a}/stats`),
  people: (a: string) => get<Json>(`/api/alerts/${a}/map/people`),
  hex: (a: string) => get<Json>(`/api/alerts/${a}/map/hex`),
  log: (a: string, after: number) => get<LogEntry[]>(`/api/alerts/${a}/log?after=${after}`),
  escalations: (a: string) => get<Escalation[]>(`/api/alerts/${a}/escalations`),
  person: (a: string, p: string | number) => get<Json>(`/api/alerts/${a}/people/${p}`),
  autopilot: (a: string) => get<{ running: boolean }>(`/api/alerts/${a}/autopilot`),
  activate: (a: string) => post<Json>(`/api/alerts/${a}/activate`),
  reset: (a: string) => post<Json>(`/api/alerts/${a}/reset`),
  setAutopilot: (a: string, on: boolean) => post<Json>(`/api/alerts/${a}/autopilot/${on ? "start" : "stop"}`),
  round: (a: string) => post<Json>(`/api/alerts/${a}/round`),
  contact: (a: string, p: string | number, channel: "voice" | "sms") =>
    post<Json>(`/api/alerts/${a}/people/${p}/contact`, { channel }),
  simulate: (a: string, lon: number, lat: number) =>
    post<Json>(`/api/alerts/${a}/simulate`, { lon, lat, radius_m: 800, n: 25 }),
  appUsers: () => get<{ id: number; name: string; address: string; lat: number; lng: number }[]>(`/api/mobile/users`),
  sendAlert: (b: Json) => post<Json>(`/api/mobile/send-alert`, b),
  review: (id: number, decision: "confirm" | "dismiss") => post<Escalation>(`/api/escalations/${id}/${decision}`),
};

// ---- tolerant field access (DB shapes may differ slightly) ----
export function pick(obj: any, paths: string[]): any {
  for (const p of paths) {
    const v = p.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
    if (v != null && v !== "") return v;
  }
  return undefined;
}

export const STATUS_COLORS: Record<string, string> = {
  critical: "#ef4444",
  needs_help: "#f59e0b",
  safe: "#22c55e",
  unreached: "#64748b",
  exhausted: "#a855f7",
};
export const STATUS_LABEL: Record<string, string> = {
  critical: "Critical",
  needs_help: "Needs help",
  safe: "Safe",
  unreached: "Unreached",
  exhausted: "Exhausted",
};
