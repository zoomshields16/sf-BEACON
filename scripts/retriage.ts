// Re-runs Nemotron triage for people whose triage came from the no-Nemotron fallback (e.g. after rate limits).
// Slow on purpose (1 request every ~2 s) so it stays under the hosted API limit.
// Usage: npx tsx scripts/retriage.ts [alertId=1]
import "dotenv/config";
import { pool } from "../src/db.js";
import { extractTriage } from "../src/agents/triage.js";
import { maybeEscalate } from "../src/agents/escalation.js";
import { getTriage, personContext, updateTriage } from "../src/repo.js";

const alertId = Number(process.argv[2] ?? 1);
const rows = (await pool.query(
  `select person_id from triage where alert_id = $1 and notes like 'Heuristic triage%' order by urgency_score desc`, [alertId],
)).rows;
console.log(`${rows.length} fallback triage(s) to redo for alert ${alertId}`);

let improved = 0;
for (const { person_id } of rows) {
  const ctx = await personContext(person_id, alertId);
  const hist = (ctx.history ?? []) as { role: string; content: string }[];
  const transcript = hist.map((m) => `${m.role}: ${m.content}`).join("\n");
  const userText = hist.filter((m) => m.role === "user").map((m) => m.content).join("\n");
  const t = await extractTriage(ctx, transcript, userText, alertId, person_id);
  const current = await getTriage(alertId, person_id);
  if (t.notes.startsWith("Heuristic") || current?.status === "critical") { await new Promise((r) => setTimeout(r, 4000)); continue; }
  await updateTriage(alertId, person_id, t);
  await maybeEscalate(ctx, t, alertId, person_id);
  improved++;
  process.stdout.write(`\r${improved}/${rows.length} re-triaged by Nemotron`);
  await new Promise((r) => setTimeout(r, 2000));
}
console.log(`\ndone: ${improved} improved, ${rows.length - improved} left as fallback`);
await pool.end();
