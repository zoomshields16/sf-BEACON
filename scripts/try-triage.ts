// Feeds fake call transcripts to the REAL extractTriage (Nemotron + keyword safety override). No DB needed.
//   npx tsx scripts/try-triage.ts [runs]      (default 2 runs per case)
import "dotenv/config";
import { nemotronEnabled } from "../src/agents/nemotron.js";
import { extractTriage } from "../src/agents/triage.js";
import { CORE_QUESTIONS } from "../src/agents/safety.js";

if (!nemotronEnabled()) throw new Error("Set NVIDIA_API_KEY and NEMOTRON_MODEL in .env");

interface Case { name: string; says: string[]; profile?: object; ok: (t: any) => boolean; want: string; info?: string }
const cases: Case[] = [
  { name: "all safe", says: ["Yes, we're all fine.", "No, nobody is hurt.", "Yes, the house is holding up."],
    ok: (t) => t.status === "safe" && t.urgency_score <= 30, want: "safe, urgency <= 30" },
  { name: "needs supplies", says: ["We're okay.", "No one is hurt.", "Not really, power's been out since last night and my mom's insulin needs ice."],
    profile: { name: "Dana", age: 45 }, ok: (t) => t.status === "needs_help" && t.urgency_score >= 30 && t.urgency_score < 70 && t.needs.length > 0, want: "needs_help, urgency 30-69, needs listed" },
  { name: "obvious danger", says: ["No! The water is rising in the living room and we're trapped upstairs.", "My husband slipped and he's bleeding.", "No."],
    ok: (t) => t.status === "critical" && t.urgency_score >= 85, want: "critical, urgency >= 85" },
  { name: "subtle danger (no keywords)", says: ["I don't know, my husband isn't answering me.", "He's on the couch, he's cold and gray and he won't wake up.", "I don't know."],
    ok: (t) => t.status === "critical", want: "critical (model must catch it; no keyword matches)" },
  { name: "property damage only", says: ["Yes, we're fine.", "Nobody's hurt.", "Yes. A tree fell on our car and the fence is gone but the house is fine."],
    ok: (t) => t.status !== "critical" && t.urgency_score <= 49, want: "not critical, urgency <= 49" },
  { name: "oxygen battery running out", says: ["We're not in danger right now.", "No one is hurt.", "My mom's oxygen concentrator is on battery, the power is out and it has about two hours left."],
    profile: { age: 81, medical_needs: "home oxygen" }, ok: (t) => t.status === "critical" || (t.status === "needs_help" && t.urgency_score >= 70), want: "needs_help urgency >= 70, or critical" },
  { name: "hung up after Q1", says: ["Yeah we're okay."],
    ok: (t) => t.status !== "critical", want: "not critical" },
  { name: "NEGATED danger words", says: ["Yes we're safe, nobody is trapped.", "No, nobody is bleeding or hurt.", "Yes, the house is fine."],
    ok: (t) => t.status === "safe", want: "safe", info: "keyword override ignores negation, so this may be forced to critical" },
];

const runs = Number(process.argv[2] ?? 2);
let pass = 0, total = 0;
for (const c of cases) {
  const lines: string[] = [];
  c.says.forEach((s, i) => { lines.push(`agent: ${CORE_QUESTIONS[i]}`, `user: ${s}`); });
  let good = 0; let last: any;
  for (let i = 0; i < runs; i++) {
    last = await extractTriage({ profile: c.profile ?? {} }, lines.join("\n"), c.says.join("\n"), 1, 1);
    if (c.ok(last)) good++;
  }
  if (!c.info) { total += runs; pass += good; }
  console.log(`\n${good === runs ? "PASS" : c.info ? "INFO" : "FAIL"}  ${c.name}  (${good}/${runs})  want: ${c.want}`);
  console.log(`      got: ${last.status} ${last.urgency_score}  needs=[${last.needs.join(", ")}]  ${last.notes.slice(0, 110)}`);
  if (c.info && good < runs) console.log(`      note: ${c.info}`);
}
console.log(`\n${pass}/${total} checks passed (INFO cases not counted)`);
process.exit(0);
