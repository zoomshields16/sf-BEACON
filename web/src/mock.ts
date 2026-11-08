// In-browser fake backend for ?mock=1 — lets the dashboard run (and demo) with no API/DB.
type Status = "unreached" | "safe" | "needs_help" | "critical" | "exhausted";
interface Person {
  id: number; name: string; phone: string; address: string; lat: number; lon: number;
  household: number; age: number; medical: string | null;
  status: Status; urgency: number; attempts: number; needs: string[]; notes: string;
  history: { channel: "voice" | "sms"; role: "agent" | "user"; content: string; created_at: string }[];
}

const CENTER = { lat: 29.7604, lon: -95.3698 };
const FIRST = ["Maria", "James", "Linda", "Robert", "Aisha", "Wei", "Carlos", "Patricia", "Daniel", "Grace", "Tomas", "Nina", "Harold", "Priya", "Luis", "Ruth"];
const LAST = ["Garcia", "Nguyen", "Johnson", "Patel", "Williams", "Okafor", "Kim", "Hernandez", "Brown", "Lopez", "Davis", "Chen"];
const STREETS = ["Bayou Ln", "Westheimer Rd", "Montrose Blvd", "Heights Blvd", "Shepherd Dr", "Navigation Blvd", "Telephone Rd"];

let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const now = () => new Date().toISOString();

const people: Person[] = Array.from({ length: 160 }, (_, i) => {
  const r = Math.sqrt(rnd()) * 0.07, t = rnd() * Math.PI * 2;
  const age = 20 + Math.floor(rnd() * 70);
  return {
    id: 1000 + i,
    name: `${FIRST[i % FIRST.length]} ${LAST[(i * 7) % LAST.length]}`,
    phone: `+1713555${String(1000 + i).padStart(4, "0")}`,
    address: `${100 + Math.floor(rnd() * 9000)} ${STREETS[i % STREETS.length]}, Houston, TX`,
    lat: CENTER.lat + Math.sin(t) * r, lon: CENTER.lon + Math.cos(t) * r * 1.15,
    household: 1 + Math.floor(rnd() * 5), age,
    medical: age > 70 && rnd() > 0.4 ? "oxygen concentrator" : rnd() > 0.88 ? "insulin" : null,
    status: "unreached", urgency: 0, attempts: 0, needs: [], notes: "", history: [],
  };
});

// Hex grid (flat approx) with risk.
const HEX_R = 0.012;
const hexes: { id: string; lat: number; lon: number; risk: number }[] = [];
for (let q = -6; q <= 6; q++) for (let r = -6; r <= 6; r++) {
  const lon = CENTER.lon + HEX_R * 1.5 * q * 1.15;
  const lat = CENTER.lat + HEX_R * Math.sqrt(3) * (r + q / 2);
  if (Math.hypot(lat - CENTER.lat, (lon - CENTER.lon) / 1.15) < 0.075) hexes.push({ id: `h${q}_${r}`, lat, lon, risk: rnd() * 0.3 });
}
const hexPoly = (h: { lat: number; lon: number }) => {
  const pts = Array.from({ length: 7 }, (_, k) => {
    const a = (Math.PI / 3) * (k % 6);
    return [h.lon + HEX_R * Math.cos(a) * 1.15, h.lat + HEX_R * Math.sin(a) * 0.98];
  });
  return [pts];
};

let logId = 0;
const log: any[] = [];
const escalations: any[] = [];
let active = false;
let timer: number | undefined;

function addLog(agent: string, thought: string, tool: string | null = null, person_id: number | null = null, output: any = null, input: any = null) {
  log.push({ id: ++logId, agent, thought, tool, person_id, input, output, created_at: now() });
}

const SCENARIOS: Record<Exclude<Status, "unreached" | "exhausted">, { answers: string[]; needs: string[]; notes: string; urgency: number }> = {
  safe: { answers: ["Yes, we're all fine.", "No, nobody's hurt.", "Yes, the house is okay."], needs: [], notes: "Household safe, no damage reported.", urgency: 8 },
  needs_help: { answers: ["We're okay for now.", "No one is injured.", "Not really — power's out and my mom's oxygen machine needs it."], needs: ["power", "medication"], notes: "Power out; elderly resident on oxygen needs backup power or relocation.", urgency: 68 },
  critical: { answers: ["No! Water is rising in the living room and we're trapped upstairs."], needs: ["rescue"], notes: "Water rising inside home; residents trapped on second floor.", urgency: 95 },
};

function step() {
  const queue = people.filter((p) => p.status === "unreached" && p.attempts < 4)
    .sort((a, b) => (b.medical ? 1 : 0) - (a.medical ? 1 : 0) || b.age - a.age).slice(0, 4);
  if (!queue.length) return;
  addLog("coordinator", `Pulled call queue — ${queue.length} highest-priority policyholders (medical needs, age 70+ first)`, "get_call_queue", null, queue.map((p) => ({ person_id: p.id, next_channel: p.attempts >= 2 ? "sms" : "voice" })));

  for (const p of queue) {
    const channel = p.attempts >= 2 ? "sms" : "voice";
    p.attempts++;
    addLog("triage", `Script for ${p.name}: 3 safety questions + ${p.medical ? `ask about ${p.medical}` : "household follow-ups"}`, "generate_call_script", p.id);
    addLog("coordinator", channel === "voice" ? `Calling ${p.name}` : `2 unanswered calls — texting ${p.name}`, channel === "voice" ? "place_voice_call" : "send_text", p.id);

    window.setTimeout(() => {
      const roll = rnd();
      if (roll < 0.22 && channel === "voice") {
        addLog("coordinator", `No answer from ${p.name} (attempt ${p.attempts}) — will retry`, "get_call_result", p.id);
        if (p.attempts >= 4) p.status = "exhausted";
        return;
      }
      const kind = roll < 0.3 ? "critical" : roll < 0.55 || p.medical ? "needs_help" : "safe";
      const s = SCENARIOS[kind];
      const qs = ["Are you and everyone in your home safe right now?", "Is anyone injured?", "Is your home safe to stay in tonight?"];
      if (channel === "voice") {
        s.answers.forEach((a, i) => p.history.push(
          { channel, role: "agent", content: qs[i], created_at: now() },
          { channel, role: "user", content: a, created_at: now() }));
        if (kind === "critical") p.history.push({ channel, role: "agent", content: "Please hang up and call 911 now. I'm also alerting emergency responders.", created_at: now() });
      } else {
        p.history.push({ channel, role: "agent", content: "State Farm SafeNet: are you and everyone in your home safe right now? Reply SAFE or HELP. If you're in immediate danger, call 911.", created_at: now() },
          { channel, role: "user", content: s.answers[s.answers.length - 1], created_at: now() });
      }
      Object.assign(p, { status: kind, urgency: s.urgency, needs: s.needs, notes: s.notes });
      if (kind === "needs_help" && p.medical) {
        escalations.unshift({ id: escalations.length + 1, kind: "urgent_assist", person_id: p.id, status: "pending_review", created_at: now(),
          reason: `${p.medical} at risk without power; needs responder follow-up today.`,
          payload: { caller: { name: p.name, phone: p.phone }, location: { address: p.address }, emergency: { type: "medical need", urgency_score: s.urgency } } });
        addLog("escalation", `Queued urgent assistance for ${p.name} (not 911)`, "request_assistance", p.id);
      }
      addLog("triage", `Extracted triage → ${kind} (${s.urgency})${kind === "critical" ? " — SAFETY OVERRIDE: danger keywords [water, trapped]" : ""}`, "update_triage", p.id,
        { status: kind, urgency_score: s.urgency, needs: s.needs, notes: s.notes });
      if (kind === "critical") {
        const payload = { provider: "RapidSOS (simulated)", caller: { name: p.name, phone: p.phone }, location: { address: p.address, lat: p.lat, lon: p.lon },
          emergency: { type: "flood — trapped", urgency_score: s.urgency, location_in_home: "second floor", needs: s.needs, notes: s.notes } };
        escalations.unshift({ id: escalations.length + 1, kind: "911", person_id: p.id, reason: "Water rising inside home; residents trapped.", status: "pending_review", payload, created_at: now() });
        addLog("escalation", `Created 911 escalation #${escalations.length} (pending human review)`, "escalate_to_911", p.id, payload);
        const h = hexes.reduce((b, x) => (Math.hypot(x.lat - p.lat, x.lon - p.lon) < Math.hypot(b.lat - p.lat, b.lon - p.lon) ? x : b));
        h.risk = Math.min(1, h.risk + 0.35);
      }
    }, 1500 + rnd() * 3500);
  }
}

function stats() {
  const c = (s: Status) => people.filter((p) => p.status === s).length;
  return { total: people.length, unreached: c("unreached"), safe: c("safe"), needs_help: c("needs_help"),
           critical: c("critical"), exhausted: c("exhausted"), high_risk_hexes: hexes.filter((h) => h.risk > 0.6).length };
}

export function mockRequest(method: string, path: string, _body?: unknown): any {
  const m = (re: RegExp) => path.match(re);
  if (path === "/health") return { ok: true, db: true, mock: true, nemotron: true };
  if (path === "/api/alerts") return [
    { id: 1, nws_id: "demo-ffw-houston-1", event_type: "Flash Flood Warning", headline: null, severity: "Severe", area_desc: "Harris, TX",
      status: active ? "active" : "pending", expires: null, source: "demo", people_inside: people.length },
    { id: 2, nws_id: "urn:oid:demo", event_type: "Flood Watch", headline: null, severity: "Severe", area_desc: "La Salle; McMullen; Live Oak",
      status: "pending", expires: null, source: "nws", people_inside: 0 },
  ];
  if (path === "/api/alerts/nws/sync") return { fetched: 3, stored: [], alerts: mockRequest("GET", "/api/alerts") };
  if (m(/\/stats$/)) return stats();
  if (m(/\/map\/people$/)) return { type: "FeatureCollection", features: people.map((p) => ({ type: "Feature",
    geometry: { type: "Point", coordinates: [p.lon, p.lat] },
    properties: { person_id: p.id, name: p.name, status: p.status, urgency_score: p.urgency } })) };
  if (m(/\/map\/hex$/)) return { type: "FeatureCollection", features: hexes.map((h) => ({ type: "Feature",
    geometry: { type: "Polygon", coordinates: hexPoly(h) }, properties: { hex_id: h.id, risk: h.risk } })) };
  if (m(/\/log/)) {
    const after = Number(new URL(path, location.origin).searchParams.get("after") ?? 0);
    return log.filter((l) => l.id > after).reverse().slice(0, 100);
  }
  if (m(/\/escalations$/)) return escalations;
  if (m(/\/autopilot$/)) return { running: active };
  const person = m(/\/people\/(\d+)$/);
  if (person && method === "GET") {
    const p = people.find((x) => x.id === Number(person[1]))!;
    return { profile: { name: p.name, phone: p.phone, address: p.address, household_size: p.household, age: p.age, medical_needs: p.medical },
             triage: { status: p.status, urgency_score: p.urgency, needs: p.needs, notes: p.notes, attempts: p.attempts }, history: p.history };
  }
  if (m(/\/activate$/) || m(/\/autopilot\/start$/)) {
    if (m(/\/activate$/)) addLog("system", "Alert activated — Flash Flood Warning, Harris County. 160 policyholders inside polygon.");
    active = true; clearInterval(timer); step(); timer = window.setInterval(step, 4000);
    return { ok: true };
  }
  if (m(/\/reset$/)) { active = false; clearInterval(timer); log.length = 0; escalations.length = 0;
    people.forEach((p) => Object.assign(p, { status: "unreached", urgency: 0, attempts: 0, needs: [], notes: "", history: [] }));
    hexes.forEach((h) => (h.risk = rnd() * 0.3)); return { reset: true }; }
  if (m(/\/autopilot\/stop$/)) { active = false; clearInterval(timer); return { stopped: true }; }
  if (m(/\/round$/)) { step(); return { ok: true }; }
  const contact = m(/\/people\/(\d+)\/contact$/);
  if (contact) {
    const p = people.find((x) => x.id === Number(contact[1]))!;
    const prior = [...p.history].reverse().find((h) => h.role === "user");
    const text = prior ? `State Farm SafeNet: On our call you said "${prior.content}" Is that still the case? Reply SAFE or HELP. If you're in immediate danger, call 911.`
                       : "State Farm SafeNet: are you and everyone in your home safe right now? Reply SAFE or HELP.";
    p.history.push({ channel: "sms", role: "agent", content: text, created_at: now() });
    addLog("triage", prior ? "Composed follow-up text referencing the call" : "Composed check-in text", "send_text", p.id, { text });
    return { status: "started" };
  }
  if (m(/\/simulate$/)) {
    const { lon, lat } = _body as { lon: number; lat: number };
    hexes.forEach((h) => { if (Math.hypot(h.lat - lat, h.lon - lon) < 0.02) h.risk = Math.min(1, h.risk + 0.5); });
    addLog("system", `Simulated 25 crowdsourced reports near ${lat.toFixed(3)}, ${lon.toFixed(3)}`);
    addLog("coordinator", "Hex risk shifted — re-planning: prioritizing policyholders in new hotspot", "get_hex_risk");
    return { ok: true };
  }
  const review = m(/\/escalations\/(\d+)\/(confirm|dismiss)$/);
  if (review) {
    const e = escalations.find((x) => x.id === Number(review[1]));
    if (e) e.status = review[2] === "confirm" ? "confirmed" : "dismissed";
    addLog("escalation", `Responder ${review[2]}ed escalation #${review[1]}${review[2] === "confirm" ? " — payload sent to RapidSOS (simulated)" : ""}`);
    return e;
  }
  throw new Error(`mock: no route for ${method} ${path}`);
}
