import { runAgent } from "./nemotron.js";
import { COORDINATOR_TOOLS } from "./tools.js";
import { contactPerson, isInFlight } from "./pipeline.js";
import { callQueue, hexRisk, logAgent, type Id, type Row } from "../repo.js";

const BATCH = Number(process.env.COORDINATOR_BATCH ?? 5);
const running = new Set<string>();
const autopilots = new Map<string, NodeJS.Timeout>();
const lastHotHexes = new Map<string, string>();

const SYSTEM = `You are the dispatch coordinator for State Farm SafeNet during a disaster.
Goal: reach every policyholder inside the alert, most urgent first, and make sure no one is overlooked.
Each round:
1. Call get_call_queue (and get_hex_risk if risk changed). Each row already has priority, hex_risk and reasons —
   do NOT call get_person_context unless two people are tied and you need more detail.
2. For each person you choose, call them with place_voice_call (texting is disabled; ignore next_channel "sms" and call again).
   Prefer people in high-risk hexagons, elderly/medical-needs households, and people never reached.
3. Do not contact anyone whose attempt is already in progress.
4. If get_call_result shows a life-threatening situation that has no escalation yet, call escalate_to_911.
Refer to people by name (never assume gender). Don't stop to summarize until the calls are placed.
Before EVERY tool call, write one short sentence in your message explaining why (e.g. "Maria is 81 on oxygen in a flooded hex — calling her first."). When the round's contacts are started, reply with a one-sentence summary.`;

/** Top-risk hexes as a signature, so we can notice when the risk picture changes. */
async function hotHexSignature(alertId: Id) {
  try {
    const rows = await hexRisk(alertId);
    const score = (r: Row) => Number(r.risk ?? r.risk_score ?? r.score ?? 0);
    const id = (r: Row) => String(r.h3 ?? r.hex_id ?? r.hex ?? r.id ?? "");
    return [...rows].sort((a, b) => score(b) - score(a)).slice(0, 3).map(id).join(",");
  } catch {
    return "";
  }
}

async function fallbackRound(alertId: Id) {
  const queue = await callQueue(alertId, BATCH * 2);
  const picks = queue.filter((r) => !isInFlight(alertId, r.person_id)).slice(0, BATCH);
  await logAgent({
    alertId, agent: "coordinator", tool: "get_call_queue",
    thought: `Rule-based dispatch: contacting ${picks.length} people in priority order`, output: picks,
  });
  await Promise.all(picks.map((r) => contactPerson(alertId, r.person_id, r.next_channel === "sms" ? "sms" : "voice")));
}

export async function coordinatorRound(alertId: Id) {
  const k = String(alertId);
  if (running.has(k)) return { skipped: true };
  running.add(k);
  try {
    const sig = await hotHexSignature(alertId);
    const changed = sig !== "" && lastHotHexes.has(k) && lastHotHexes.get(k) !== sig;
    lastHotHexes.set(k, sig);
    if (changed) {
      await logAgent({ alertId, agent: "coordinator", tool: "get_hex_risk", thought: `Hex risk shifted (hot: ${sig}) — re-planning priorities` });
    }

    const r = await runAgent({
      agent: "coordinator",
      alertId,
      system: SYSTEM,
      task: `Alert ${alertId}. Start contact with up to ${BATCH} people this round.${changed ? " Risk hotspots just changed — check get_hex_risk first and prioritize those areas." : ""}`,
      tools: COORDINATOR_TOOLS,
      maxSteps: BATCH * 3 + 4,
      mustCallOneOf: ["place_voice_call", "send_text"],
    });
    const contacted = r.called.some((c) => c === "place_voice_call" || c === "send_text");
    if (!r.ok || !contacted) await fallbackRound(alertId);
    return { skipped: false, nemotron: r.ok && contacted, summary: r.final };
  } finally {
    running.delete(k);
  }
}

export function startAutopilot(alertId: Id, everyMs = Number(process.env.COORDINATOR_INTERVAL_MS ?? 15000)) {
  const k = String(alertId);
  if (autopilots.has(k)) return false;
  const tick = () => coordinatorRound(alertId).catch((e) => console.error("coordinator round", e));
  tick();
  autopilots.set(k, setInterval(tick, everyMs));
  return true;
}

export function stopAutopilot(alertId: Id) {
  const k = String(alertId);
  clearInterval(autopilots.get(k));
  return autopilots.delete(k);
}

export const isAutopilot = (alertId: Id) => autopilots.has(String(alertId));
