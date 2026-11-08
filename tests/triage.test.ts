// Fallback (no-Nemotron) triage must not mark safe people as needing help, or miss real needs.
import { test } from "node:test";
import assert from "node:assert/strict";
delete process.env.NVIDIA_API_KEY;
const { extractTriage } = await import("../src/agents/triage.js");
const triage = (said: string) => extractTriage({}, said, said, 1, 1);

test("'No, nobody is hurt' + 'plenty of water' is safe, with no needs", async () => {
  const r = await triage("Yes, we're all fine here. No, nobody is hurt. Yes, the house is holding up okay. We have plenty of water and food, thanks.");
  assert.equal(r.status, "safe");
  assert.deepEqual(r.needs, []);
});

test("real needs are detected", async () => {
  const r = await triage("Not really, the power has been out since last night. My mom needs her insulin kept cold and we're out of ice. We could use a ride to a shelter.");
  assert.equal(r.status, "needs_help");
  for (const n of ["power", "medication", "transportation"]) assert.ok(r.needs.includes(n), n);
});

test("damage is a problem even without a listed need", async () => {
  assert.equal((await triage("We're ok but the roof is leaking.")).status, "needs_help");
});

test("danger keywords always force critical", async () => {
  const r = await triage("The water is rising in the living room and we're trapped upstairs.");
  assert.equal(r.status, "critical");
  assert.ok(r.urgency_score >= 90);
});
