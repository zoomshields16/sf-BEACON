// Self-check for call edge cases. No phone, DB, or Nemotron needed:  npx tsx scripts/check-cases.ts
import assert from "node:assert/strict";
delete process.env.NVIDIA_API_KEY; // force the no-model path: cases must work with Nemotron down
import { classify } from "../src/voice/cases.js";
import { CallBrain, type CallSession, type Turn } from "../src/voice/brain.js";
import { CORE_QUESTIONS, EMERGENCY_LINE, detectDanger } from "../src/agents/safety.js";
import { welfareUrgency } from "../src/agents/escalation.js";

const eq = (text: string, want: string | null) => assert.equal(classify(text), want, `classify("${text}")`);
eq("Please leave a message after the tone", "voicemail");
eq("The person you are calling is not available", "voicemail");
eq("Stop calling me", "opt_out");
eq("please take me off your list", "opt_out");
eq("You have the wrong number", "wrong_person");
eq("she's not here right now", "wrong_person");
eq("no hablo ingles", "language");
eq("I don't speak English", "language");
eq("can you call me back later", "callback");
eq("this is a bad time", "callback");
eq("are you a robot?", "ai_question");
eq("is this a scam", "ai_question");
eq("when is help coming?", "help_question");
eq("Yes we're all fine", null);
eq("No one is hurt", null);

// Negation: safe answers must NOT trigger danger; real danger (even right next to a negation) must.
for (const s of ["nobody is trapped", "no one is bleeding", "we are not stuck", "No, nobody is hurt or injured", "there's no gas smell",
  "it's not an emergency", "Yes we're safe, nobody is trapped.\nNo, nobody is bleeding or hurt."]) {
  assert.equal(detectDanger(s).danger, false, `should NOT be danger: "${s}"`);
}
for (const s of ["No! The water is rising in the living room", "no one is hurt but we're trapped", "he is not breathing", "I can't breathe",
  "nobody can get to us, we're trapped", "we're not okay, we're trapped upstairs", "Nobody is hurt and my husband is bleeding badly"]) {
  assert.equal(detectDanger(s).danger, true, `SHOULD be danger: "${s}"`);
}

const session: CallSession = {
  alertId: null, personId: null, attemptId: null, ctx: {},
  script: { opening: "Hi.", questions: [...CORE_QUESTIONS], closing: "Bye.", source: "fallback" },
};
const run = async (said: string) => {
  const brain = new CallBrain(session);
  const t: Turn[] = [{ role: "agent", content: brain.opening().say }, { role: "user", content: said }];
  return { brain, r: await brain.reply(t) };
};

for (const [said, outcome] of [
  ["leave your message after the beep", "voicemail"], ["stop calling me", "opt_out"],
  ["wrong number", "wrong_person"], ["call me back later", "callback"], ["no hablo ingles", "language"],
] as const) {
  const { brain, r } = await run(said);
  assert.ok(r.endCall, `${outcome} should end the call`);
  assert.equal(brain.outcome, outcome);
  if (outcome === "voicemail") assert.equal(r.say, "", "never leave a voicemail message");
  else assert.ok(r.say.toLowerCase().includes("911"), `${outcome} reply should give the 911 line`);
}

const robot = await run("are you a robot?"); // answers, keeps the call going, repeats the question
assert.equal(robot.r.endCall, false);
assert.ok(robot.r.say.includes(CORE_QUESTIONS[0]));
assert.equal(robot.brain.outcome, null);

const hp = await run("when is help coming?"); // must never promise help
assert.equal(hp.r.endCall, false);
assert.match(hp.r.say, /can't promise/);

const danger = await run("stop calling me, the water is rising in the house"); // danger beats every other case
assert.ok(danger.r.say.includes(EMERGENCY_LINE));
assert.equal(danger.brain.outcome, null);

assert.equal(new CallBrain(session).giveUp().endCall, true);

assert.equal(welfareUrgency({}), 70);
assert.equal(welfareUrgency({ age: 80, medical_needs: "oxygen" }), 90);
assert.equal(welfareUrgency({ age: 40, medical_needs: "insulin" }), 80);
console.log("all call-case checks passed");
process.exit(0);
