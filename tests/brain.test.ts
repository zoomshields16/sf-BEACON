// The live-call brain with Nemotron OFF: proves calls never go out broken and danger always ends the call.
import { test } from "node:test";
import assert from "node:assert/strict";
delete process.env.NVIDIA_API_KEY;
const { CallBrain } = await import("../src/voice/brain.js");
const { CORE_QUESTIONS } = await import("../src/agents/safety.js");

const script = { opening: "Hi, SafeNet here.", questions: [...CORE_QUESTIONS, "Do you have power?"], closing: "Goodbye.", source: "fallback" as const };
const session = () => ({ alertId: null, personId: null, attemptId: null, ctx: {}, script });

async function run(answers: string[], onDanger?: (t: string, m: string[]) => Promise<void>) {
  const b = new CallBrain(session(), onDanger);
  const t: { role: "agent" | "user"; content: string }[] = [];
  let r = b.opening();
  t.push({ role: "agent", content: r.say });
  for (let i = 0; i < 10 && !r.endCall; i++) {
    t.push({ role: "user", content: answers[i] ?? "That's all." });
    r = await b.reply(t);
    t.push({ role: "agent", content: r.say });
  }
  return { t, last: r };
}

test("asks the 3 safety questions first, in order", async () => {
  const { t } = await run(["Yes", "No", "Yes", "Yes"]);
  const asked = t.filter((x) => x.role === "agent").map((x) => x.content);
  CORE_QUESTIONS.forEach((q, i) => assert.ok(asked[i].endsWith(q), `question ${i + 1}: ${asked[i]}`));
});

test("danger → 911 line, call ends, escalation callback fires", async () => {
  let fired = "";
  const { last } = await run(["We're okay", "My son is bleeding badly"], async (_t, m) => { fired = m.join(","); });
  assert.equal(last.endCall, true);
  assert.match(last.say, /Please hang up and call 911 now/);
  assert.ok(fired.includes("injury"));
});

test("'hello?' repeats the question instead of counting as an answer", async () => {
  const { t } = await run(["Hello?", "Yes we're fine", "No", "Yes", "Yes"]);
  assert.match(t[2].content, /Are you and everyone in your home safe right now\?/);
  assert.match(t[4].content, /Is anyone injured\?/);
});

test("without Nemotron the call still completes on the scripted fallback", async () => {
  const { t, last } = await run(["Yes", "No", "Yes", "We have power"]);
  assert.equal(last.endCall, true);
  assert.ok(t.some((x) => x.content.includes("Do you have power?")));
  assert.equal(last.say, "Goodbye.");
});
