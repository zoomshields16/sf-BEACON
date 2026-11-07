// Safety rules — these must never regress. Runs without Nemotron, DB, or phones.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CORE_QUESTIONS, EMERGENCY_LINE, detectDanger, stripFalsePromises, fallbackFollowups } from "../src/agents/safety.js";

test("danger keywords fire on immediate danger", () => {
  for (const t of ["We're trapped upstairs", "my husband is bleeding badly", "the water is rising in the living room",
                   "I smell gas", "he's not breathing", "please send help", "the roof collapsed"]) {
    assert.equal(detectDanger(t).danger, true, t);
  }
});

test("no false alarms on ordinary answers", () => {
  for (const t of ["Yes, we're all fine.", "No, nobody is hurt.", "The power is out but we're okay.", "We have food and water."]) {
    assert.equal(detectDanger(t).danger, false, t);
  }
});

test("the three fixed safety questions are exactly as specified", () => {
  assert.deepEqual([...CORE_QUESTIONS], [
    "Are you and everyone in your home safe right now?",
    "Is anyone injured?",
    "Is your home safe to stay in tonight?",
  ]);
  assert.equal(EMERGENCY_LINE, "Please hang up and call 911 now.");
});

test("never promise that help is coming", () => {
  assert.equal(stripFalsePromises("Understood. Help is on the way."), "Understood.");
  assert.equal(stripFalsePromises("Stay safe until help arrives."), "Thank you.");
  assert.equal(stripFalsePromises("Responders are on their way to you. Do you have power?"), "Do you have power?");
  assert.equal(stripFalsePromises("Glad you're safe. Do you have water?"), "Glad you're safe. Do you have water?");
});

test("every disaster type has fallback questions", () => {
  for (const e of ["Flash Flood Warning", "Hurricane Warning", "Tornado Warning", "Red Flag Warning", "Winter Storm Warning", "Earthquake"]) {
    assert.ok(fallbackFollowups(e).length >= 2, e);
  }
});
