// Only allowlisted numbers may ever be dialed for real (no surprise phone bills, no calling strangers).
import { test } from "node:test";
import assert from "node:assert/strict";
process.env.LIVE_CALL_ALLOWLIST = "+12148675309, +13127771234";
const { isLiveDialable } = await import("../src/services/livekit.js");

test("allowlisted numbers are dialable", () => {
  assert.equal(isLiveDialable("+1 (214) 867-5309"), true);
  assert.equal(isLiveDialable("+13127771234"), true);
});
test("everything else is simulated", () => {
  assert.equal(isLiveDialable("+15552000001"), false);  // seeded fake
  assert.equal(isLiveDialable("+19998887777"), false);  // not on the list
});
test("a 555 number is never dialed, even if someone allowlists it", () => {
  process.env.LIVE_CALL_ALLOWLIST = "+12145550100";
  assert.equal(isLiveDialable("+12145550100"), false);
});
