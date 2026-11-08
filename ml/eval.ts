// Step 5 — out-of-distribution check: the hand-written caller lines from scripts/eval-danger.ts (NOT from the
// synthetic generator). Usage: npx tsx ml/eval.ts
import "dotenv/config";
import { classifyRisk } from "../src/agents/risk-model.js";

const CASES: [string, boolean][] = [
  ["The water is coming in under the door and it's up to my ankles in the living room.", true],
  ["My husband fell down the stairs and he's not getting up.", true],
  ["I can't breathe very well, the smoke is getting in.", true],
  ["We're stuck in the attic and the water's still rising.", true],
  ["My mom's oxygen machine stopped and her lips are turning blue.", true],
  ["A tree came through the roof and my son is pinned under a beam.", true],
  ["I smell gas really strong in the kitchen.", true],
  ["My baby has a really high fever and I can't wake him up properly.", true],
  ["Our car got swept off the road, we're sitting on the roof of it.", true],
  ["I think I'm having a heart attack, my chest really hurts.", true],
  ["Please, someone needs to come, the water is at our chests.", true],
  ["Yeah, we're fine, just a lot of rain and thunder.", false],
  ["The street out front is flooded but our house is dry.", false],
  ["The power went out about an hour ago, we have flashlights.", false],
  ["I'm really scared, the storm is so loud.", false],
  ["The basement has a couple inches of water, nobody's down there.", false],
  ["Our car is probably ruined, it's parked in the water.", false],
  ["A tree fell in the backyard, it missed the house.", false],
  ["Nobody is hurt now, my neighbor was trapped earlier but the fire department got her out.", false],
  ["I cut my finger on some glass but it's fine, I put a bandage on it.", false],
  ["We're low on food, maybe two days left.", false],
  ["My dog ran off in the storm, I'm worried sick.", false],
  ["The water came up to the porch but it's going down now.", false],
  // the two live-call lines that caused false alarms tonight
  ["Yes. There was a lot of water around, and I heard some thundering.", false],
  ["Yeah. It's a little loud outside, though.", false],
];

let tp = 0, fn = 0, fp = 0, tn = 0;
for (const [text, threat] of CASES) {
  const r = await classifyRisk(text);
  const said = r?.label === "life_threat";
  if (threat && said) tp++; else if (threat) fn++; else if (said) fp++; else tn++;
  console.log(`${said === threat ? "✔" : "✖"} ${r?.label.padEnd(11)} ${String(Math.round((r?.p ?? 0) * 100)).padStart(3)}%  ${text}`);
}
console.log(`\nlife threats caught ${tp}/${tp + fn} · false alarms ${fp}/${fp + tn} · accuracy ${Math.round((100 * (tp + tn)) / CASES.length)}%`);
