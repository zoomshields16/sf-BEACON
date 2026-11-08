// Regression tests for the code-review findings (2026-11-07).
import { test } from "node:test";
import assert from "node:assert/strict";
const { detectDanger } = await import("../src/agents/safety.js");
const { classify } = await import("../src/voice/cases.js");

test("unpunctuated speech-to-text still triggers danger", () => {
  for (const t of ["no the water is rising", "nobody here the water's coming in", "No! The water is rising", "he's not breathing",
                   "no one is hurt but we're trapped"]) {
    assert.equal(detectDanger(t).danger, true, t);
  }
});

test("genuinely negated danger is not an emergency", () => {
  for (const t of ["nobody is trapped", "we're not trapped", "there's no water coming in", "No, nobody is hurt."]) {
    assert.equal(detectDanger(t).danger, false, t);
  }
});

test("ordinary answers mid-call are not voicemail / wrong number / call-back", () => {
  assert.equal(classify("Clean water is not available here", 3), null);
  assert.equal(classify("My wife? She's not home right now", 2), null);
  assert.equal(classify("We're having a really bad time, the basement flooded", 2), null);
});

test("real edge cases are still recognized", () => {
  assert.equal(classify("Hi, you've reached Maria, please leave a message after the tone", 1), "voicemail");
  assert.equal(classify("You have the wrong number", 1), "wrong_person");
  assert.equal(classify("Can you call me back later?", 2), "callback");
  assert.equal(classify("Please stop calling me", 3), "opt_out");
});
