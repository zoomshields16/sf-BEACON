// Regression tests for the code-review findings (2026-11-07).
import { test } from "node:test";
import assert from "node:assert/strict";
const { detectDanger, isConcreteThreat } = await import("../src/agents/safety.js");
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

test("water outside / on the steps is not an emergency; water inside or chest-deep is", () => {
  assert.equal(detectDanger("The water is up to the second step outside but the house is dry.").danger, false);
  for (const t of ["the water is up to my waist", "water is coming into the house", "there's water in the living room", "the water is rising"]) {
    assert.equal(detectDanger(t).danger, true, t);
  }
});

test("Nemotron's danger flag needs a concrete life threat (live-call false alarm: 'thundering')", () => {
  assert.equal(isConcreteThreat("thundering reported", "Yes. There was a lot of water around, and I heard some thundering."), false);
  assert.equal(isConcreteThreat("flooded street", "The street is flooded and the power is out."), false);
  assert.equal(isConcreteThreat("collapsed and unresponsive", "My dad just collapsed in the kitchen and he isn't answering me."), true);
  assert.equal(isConcreteThreat("oxygen failing", "My oxygen machine just died."), true);
});

test("unwakeable / blue / seizing person always triggers (keyword, no model needed)", () => {
  for (const t of ["My baby has a really high fever and I can't wake him up properly.", "she won't wake up", "his lips are turning blue", "my daughter is having a seizure"]) {
    assert.equal(detectDanger(t).danger, true, t);
  }
  assert.equal(detectDanger("Nobody is hurt now, my neighbor was trapped earlier but the fire department got her out.").danger, false);
  assert.equal(detectDanger("My son was swept away by the water!").danger, true);
});

test("guard needs a FAILURE for devices/breathing (live false alarm: 'Oxygen device access uncertain')", () => {
  assert.equal(isConcreteThreat("Oxygen device access uncertain", "I don't think so."), false);
  assert.equal(isConcreteThreat("about the emergency", "What emergency?"), false);
  assert.equal(isConcreteThreat("breathing fine", "We're breathing fine, just scared."), false);
  for (const t of ["My oxygen machine just stopped", "the concentrator battery is almost dead", "he's not breathing", "she can't breathe"]) {
    assert.equal(isConcreteThreat(undefined, t), true, t);
  }
});

test("PyTorch risk model loads and its forward pass returns a probability distribution", async () => {
  const { riskModelAvailable, predictFromEmbedding } = await import("../src/agents/risk-model.js");
  if (!riskModelAvailable()) return;              // weights not trained in this checkout
  const w = JSON.parse((await import("node:fs")).readFileSync("ml/model/risk_classifier.json", "utf8"));
  const probs = predictFromEmbedding(new Array(w.dim).fill(0));
  const total = Object.values(probs).reduce((a: number, b: any) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-6);
  assert.deepEqual(Object.keys(probs), ["life_threat", "urgent", "routine", "safe"]);
});
