// Step 1 — synthetic training data from Nemotron (generate → independent re-label → keep only agreement).
// Usage: npx tsx ml/generate.ts [perCombo=6]   → ml/data/calls.jsonl
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { chatJSON } from "../src/agents/nemotron.js";

export const LABELS = ["life_threat", "urgent", "routine", "safe"] as const;
export type Label = (typeof LABELS)[number];

// Same definitions the live call uses (911 only for life-or-death; urgent = harm within ~12 h).
export const DEFINITIONS = `
life_threat = someone could die or be seriously hurt in the next hour: trapped, badly injured or bleeding, not breathing,
  unconscious/unresponsive, collapsed, water rising INSIDE the home, fire, gas leak, structure collapsing, swept away,
  life-support equipment failing right now.
urgent = not dying right now, but harm within ~12 hours for a vulnerable person: oxygen/medical-device battery with a few
  hours left, missed dialysis, no heat in freezing weather or no cooling in extreme heat for elderly/children, can't
  evacuate and the home is unsafe tonight with nowhere to go.
routine = needs something but not time-critical: power out, supplies for a day or more, property damage, insulin without
  ice (room-temp insulin lasts weeks), a ride later, lost pet, repairs, insurance questions, worried.
safe = everyone okay, no unmet needs (may mention weather, noise, or a danger that is already over).`;

const DISASTERS = ["flash flood", "hurricane", "tornado", "wildfire", "winter storm", "extreme heat"];
const STYLES = [
  "calm and clear", "panicked and rushed", "elderly and rambling", "very short, one sentence",
  "joking or sarcastic", "non-native English speaker", "speech-to-text output with no punctuation or capitals",
  "mentions a past or someone else's danger that is already resolved",
];

async function generate(label: Label, disaster: string, style: string, n: number): Promise<string[]> {
  const r = await chatJSON(
    `You write realistic things a policyholder might SAY on a phone call from their insurer checking on them during a ${disaster}.
Write ${n} different caller replies that are clearly in this category: ${label}.
${DEFINITIONS}
Style: ${style}. Vary people, situations and wording; 1-3 sentences each; no names of real people. JSON: {"lines": ["..."]}`,
    `Category: ${label}. Disaster: ${disaster}. Style: ${style}.`,
    (x: any) => (Array.isArray(x?.lines) ? x.lines.filter((l: unknown) => typeof l === "string" && l.length > 5 && l.length < 400) : null),
  );
  return r ?? [];
}

async function judge(lines: string[]): Promise<(Label | null)[]> {
  const r = await chatJSON(
    `You are a strict disaster triage judge. Classify EACH caller line into exactly one category.
${DEFINITIONS}
Judge only what the caller actually said. JSON: {"labels": ["life_threat"|"urgent"|"routine"|"safe", ...]} — same order and count as the input.`,
    lines.map((l, i) => `${i + 1}. ${l}`).join("\n"),
    (x: any) => (Array.isArray(x?.labels) && x.labels.length === lines.length ? x.labels : null),
  );
  return (r ?? lines.map(() => null)).map((l: any) => (LABELS.includes(l) ? l : null));
}

const perCombo = Number(process.argv[2] ?? 6);
const only = (process.argv[3] ?? "").split(",").filter(Boolean);
// GEN_STYLES="a|b|c" replaces the style list (targeted "hard example" rounds).
if (process.env.GEN_STYLES) STYLES.splice(0, STYLES.length, ...process.env.GEN_STYLES.split("|"));
const jobs = LABELS.filter((l) => !only.length || only.includes(l)).flatMap((label) => DISASTERS.flatMap((disaster) =>
  STYLES.filter((s) => !(label !== "safe" && s.startsWith("mentions a past"))).map((style) => ({ label, disaster, style }))));
console.log(`generating ${jobs.length} batches × ${perCombo} lines…`);

const rows: { text: string; label: Label; disaster: string; style: string; judge: Label | null }[] = [];
let done = 0;
await Promise.all(jobs.map(async ({ label, disaster, style }) => {
  const lines = await generate(label, disaster, style, perCombo);
  const verdicts = lines.length ? await judge(lines) : [];
  lines.forEach((text, i) => rows.push({ text, label, disaster, style, judge: verdicts[i] ?? null }));
  if (++done % 20 === 0) process.stdout.write(`  ${done}/${jobs.length} batches\n`);
}));

// Append to an existing dataset (re-runs grow it); dedupe across runs.
import { existsSync, readFileSync } from "node:fs";
const prior = existsSync("ml/data/calls.jsonl")
  ? readFileSync("ml/data/calls.jsonl", "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
const seen = new Set<string>(prior.map((r: any) => r.text.toLowerCase()));
const fresh = rows.filter((r) => r.judge === r.label && !seen.has(r.text.toLowerCase()) && seen.add(r.text.toLowerCase()));
const kept = [...prior, ...fresh];
mkdirSync("ml/data", { recursive: true });
writeFileSync("ml/data/calls.jsonl", kept.map((r) => JSON.stringify(r)).join("\n") + "\n");
const count = (l: Label) => kept.filter((r) => r.label === l).length;
console.log(`generated ${rows.length}, ${fresh.length} new lines where generator and judge agree (${Math.round((100 * fresh.length) / rows.length)}%) → dataset ${kept.length}`);
console.log(Object.fromEntries(LABELS.map((l) => [l, count(l)])));
process.exit(0);
