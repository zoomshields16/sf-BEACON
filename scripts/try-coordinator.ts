// Runs the REAL coordinator prompt + runAgent loop against fake in-memory tools. No database, no phone calls.
//   npx tsx scripts/try-coordinator.ts
// Agent steps print live (logAgent echoes to the console); "agent_log insert failed" lines are expected without a DB.
import "dotenv/config";
import { runAgent, nemotronEnabled, type ToolDef } from "../src/agents/nemotron.js";
import { SYSTEM } from "../src/agents/coordinator.js";

if (!nemotronEnabled()) throw new Error("Set NVIDIA_API_KEY and NEMOTRON_MODEL in .env");

// Stored out of order; the get_call_queue tool sorts by priority like the real DB function does.
const people = [
  { person_id: 1, name: "Tom Becker", age: 34, medical_needs: null, household_size: 2, hex: "h-low", priority: 20, next_channel: "voice" },
  { person_id: 2, name: "Eleanor Park", age: 81, medical_needs: "home oxygen concentrator (needs power)", household_size: 1, hex: "h-hot", priority: 95, next_channel: "voice" },
  { person_id: 3, name: "Dana Ruiz", age: 45, medical_needs: null, household_size: 4, hex: "h-mid", priority: 50, next_channel: "voice" },
  { person_id: 4, name: "Sam Okafor", age: 67, medical_needs: "uses a wheelchair", household_size: 2, hex: "h-hot", priority: 80, next_channel: "voice" },
  { person_id: 5, name: "Priya Nair", age: 29, medical_needs: null, household_size: 1, hex: "h-low", priority: 15, next_channel: "voice" },
];
let placed: string[] = [];
const byId = (id: any) => people.find((p) => String(p.person_id) === String(id));

const tools: ToolDef[] = [
  {
    name: "get_call_queue", description: "Next policyholders to contact for this alert, highest priority first. Includes next_channel (voice or sms).",
    parameters: { type: "object", properties: { limit: { type: "integer" } } },
    // Same shape and ordering as the real call_queue(): priority desc, with hex_risk and reasons.
    run: async () => people.filter((p) => !placed.includes(p.name)).sort((x, y) => y.priority - x.priority)
      .map(({ person_id, name, priority, next_channel, hex, medical_needs, age }) => ({
        person_id, name, priority, next_channel, attempts: 0, hex_risk: { "h-hot": 0.9, "h-mid": 0.4, "h-low": 0.05 }[hex],
        reasons: [medical_needs && `medical: ${medical_needs}`, age >= 70 && "elderly household", hex === "h-hot" && "high-risk area"].filter(Boolean),
      })),
  },
  {
    name: "get_hex_risk", description: "Crowdsourced risk per map hexagon for this alert.",
    parameters: { type: "object", properties: {} },
    run: async () => [{ hex: "h-hot", risk: 0.9, reports: 14 }, { hex: "h-mid", risk: 0.4, reports: 3 }, { hex: "h-low", risk: 0.05, reports: 0 }],
  },
  {
    name: "get_person_context", description: "Full profile and history for one policyholder.",
    parameters: { type: "object", properties: { person_id: { type: ["string", "integer"] } }, required: ["person_id"] },
    run: async ({ person_id }) => ({ profile: byId(person_id) ?? null }),
  },
  {
    name: "place_voice_call", description: "Start an AI voice check-in call. The result arrives asynchronously; check it with get_call_result.",
    parameters: { type: "object", properties: { person_id: { type: ["string", "integer"] } }, required: ["person_id"] },
    run: async ({ person_id }) => {
      const p = byId(person_id);
      if (!p) return { status: "failed", detail: "unknown person" };
      if (placed.includes(p.name)) return { status: "skipped", detail: "contact already in progress" };
      placed.push(p.name);
      return { status: "started", attemptId: placed.length };
    },
  },
  {
    name: "get_call_result", description: "Latest contact attempt status and current triage for a policyholder.",
    parameters: { type: "object", properties: { person_id: { type: ["string", "integer"] } }, required: ["person_id"] },
    run: async () => ({ attempt: { status: "in_progress" }, triage: { status: "unreached" } }),
  },
  {
    name: "escalate_to_911", description: "Create a simulated RapidSOS 911 escalation (pending human review) for a life-threatening case.",
    parameters: { type: "object", properties: { person_id: { type: ["string", "integer"] }, reason: { type: "string" } }, required: ["person_id", "reason"] },
    run: async () => ({ ok: true, escalation_id: 1 }),
  },
];

// Usage: npx tsx scripts/try-coordinator.ts [runs]   (default 1; use 5 to check consistency)
const runs = Number(process.argv[2] ?? 1);
const want = ["Eleanor Park", "Sam Okafor", "Dana Ruiz"]; // top 3 by priority (95, 80, 50)
let pass = 0;
for (let i = 1; i <= runs; i++) {
  placed = [];
  const t0 = Date.now();
  const r = await runAgent({
    agent: "coordinator", alertId: 1, system: SYSTEM, tools, maxSteps: 19,
    task: "Alert 1. Start contact with up to 3 people this round.", mustCallOneOf: ["place_voice_call"],
  });
  const ok = placed.length === 3 && want.every((n) => placed.includes(n)) && placed.slice(0, 2).every((n) => want.slice(0, 2).includes(n));
  if (ok) pass++;
  console.log(`\n[run ${i}/${runs}] ${((Date.now() - t0) / 1000).toFixed(1)}s | clean: ${r.ok} | tool calls: ${r.toolCalls}`);
  console.log(`  placed: ${placed.join(" → ") || "(none)"}  ${ok ? "PASS" : "FAIL (want Eleanor, Sam first, then Dana)"}`);
}
console.log(`\n${pass}/${runs} runs picked the right three in the right order`);
process.exit(0);
