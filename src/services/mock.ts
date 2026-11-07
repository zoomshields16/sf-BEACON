// MOCK_CALLS=true: fake calls and text replies so the whole pipeline runs without a phone line.
// Each person gets a stable scenario (hash of their id), so their text reply matches what they "said" on the call.
import { detectDanger, EMERGENCY_LINE } from "../agents/safety.js";
import type { PlaceCallInput } from "./retell.js";

type Kind = "safe" | "needs_help" | "critical" | "no_answer";
interface Scenario { kind: Kind; weight: number; answers: string[]; textReply: string }

const SCENARIOS: Scenario[] = [
  {
    kind: "safe", weight: 45,
    answers: ["Yes, we're all fine here.", "No, nobody is hurt.", "Yes, the house is holding up okay.",
              "We have plenty of water and food, thanks.", "No, we're good for now."],
    textReply: "SAFE. Still doing fine, thanks for checking.",
  },
  {
    kind: "needs_help", weight: 25,
    answers: ["We're okay for now.", "No one is injured.",
              "Not really, the power has been out since last night and it's getting cold.",
              "My mom needs her insulin kept cold and we're out of ice.", "We could use a ride to a shelter."],
    textReply: "Power is still out. We need ice for my mom's insulin and somewhere to go tonight.",
  },
  {
    kind: "critical", weight: 10,
    answers: ["No! The water is rising in the living room and we're trapped upstairs.",
              "My husband slipped and he's bleeding from his head.", "No, it isn't safe."],
    textReply: "Water is still rising, we're on the second floor, please send help",
  },
  { kind: "no_answer", weight: 20, answers: [], textReply: "Sorry missed your call, we're ok but the roof is leaking." },
];

function scenarioFor(id: string): Scenario {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  let roll = h % 100;
  for (const s of SCENARIOS) {
    if (roll < s.weight) return s;
    roll -= s.weight;
  }
  return SCENARIOS[0];
}

const delay = () => 3000 + Math.random() * 4000;
const personByPhone = new Map<string, string>();

export function simulateCall(i: PlaceCallInput): { externalId: string } {
  const s = scenarioFor(String(i.personId));
  personByPhone.set(i.toPhone, String(i.personId));
  const externalId = `mock-call-${i.attemptId}`;

  setTimeout(async () => {
    const { handleCallEnded } = await import("../agents/pipeline.js");
    if (s.kind === "no_answer") return handleCallEnded({ externalId, answered: false, transcript: [] });

    // Mirror what the Retell agent does live: ask in order; on danger, give the 911 line and end.
    const transcript: { role: "agent" | "user"; content: string }[] = [{ role: "agent", content: i.script.opening }];
    for (const [n, q] of i.script.questions.entries()) {
      const a = s.answers[n] ?? "No, that's everything.";
      transcript.push({ role: "agent", content: q }, { role: "user", content: a });
      if (detectDanger(a).danger) {
        transcript.push({ role: "agent", content: `${EMERGENCY_LINE} I'm also alerting emergency responders now.` });
        break;
      }
    }
    if (!detectDanger(transcript.map((t) => t.content).join(" ")).danger) {
      transcript.push({ role: "agent", content: i.script.closing });
    }
    await handleCallEnded({ externalId, answered: true, transcript }).catch((e) => console.error("mock call", e));
  }, delay());

  return { externalId };
}

export function simulateTextReply(toPhone: string, knownPersonId?: string | number) {
  const personId = knownPersonId != null ? String(knownPersonId) : personByPhone.get(toPhone) ?? toPhone;
  const s = scenarioFor(personId);
  personByPhone.set(toPhone, personId);
  setTimeout(async () => {
    const { handleInboundText } = await import("../agents/pipeline.js");
    console.log(`[mock sms ← ${toPhone}] ${s.textReply}`);
    await handleInboundText(toPhone, s.textReply).catch((e) => console.error("mock text", e));
  }, delay());
}
