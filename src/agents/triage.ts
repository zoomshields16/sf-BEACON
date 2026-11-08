import { chatJSON, chatText } from "./nemotron.js";
import { CORE_QUESTIONS, EMERGENCY_LINE, detectDanger, fallbackFollowups, safetyTips } from "./safety.js";
import { ctxEventType, ctxHistory, ctxName, logAgent, type Id, type Row, type TriageFields } from "../repo.js";

export interface CallScript {
  opening: string;
  questions: string[]; // always starts with CORE_QUESTIONS
  closing: string;
  source: "nemotron" | "fallback";
}

const isStrArray = (x: unknown, max: number): x is string[] =>
  Array.isArray(x) && x.length > 0 && x.length <= max && x.every((s) => typeof s === "string" && s.length > 3 && s.length < 220);

/** Pre-call: 3 fixed safety questions + 2–3 generated from person_context. Never fails. */
export async function generateCallScript(ctx: Row, alertId: Id, personId: Id): Promise<CallScript> {
  const event = ctxEventType(ctx);
  const generated = await chatJSON(
    `You write follow-up questions for a State Farm disaster check-in phone call.
The call already asks these fixed questions first: ${CORE_QUESTIONS.join(" | ")}
Write 2-3 SHORT, plain-language follow-up questions tailored to this person (household, medical needs, pets,
SafeRoom, location, prior answers). Only ask about things in the profile (no pets unless pets are listed).
Never repeat the fixed questions. JSON: {"questions": ["..."]}`,
    JSON.stringify(ctx).slice(0, 6000),
    (x: any) => (isStrArray(x?.questions, 3) ? (x.questions as string[]) : null),
  );
  const followups = generated ?? fallbackFollowups(event).slice(0, 3);
  const source = generated ? "nemotron" : "fallback";

  const script: CallScript = {
    // First thing the caller hears: there is a <storm> in your area right now.
    opening: `Hi ${ctxName(ctx)}, this is the State Farm BEACON assistant. There's a ${event} in your area right now, and I'm calling to make sure you and everyone in your home are safe. I have a few quick questions.`,
    questions: [...CORE_QUESTIONS, ...followups],
    // Non-emergency calls end with standard storm-safety tips (emergencies end on the 911 line instead).
    closing: `Thank you. Before you go — try to stay calm and take slow, deep breaths; you're doing the right things. A few safety tips: ${safetyTips(event, ctx.profile ?? {})} If anything changes or you are in danger, call 911. A State Farm responder will follow up.`,
    source,
  };
  await logAgent({
    alertId, personId, agent: "triage", tool: "generate_call_script",
    thought: source === "nemotron" ? "Generated personalized follow-up questions" : "Nemotron unavailable/invalid — using fixed question list",
    output: script,
  });
  return script;
}

// ---------- post-call / post-text extraction ----------
const STATUSES = ["safe", "needs_help", "critical", "unreached"] as const;

function validateTriage(x: any): TriageFields | null {
  if (!x || !STATUSES.includes(x.status)) return null;
  const score = Number(x.urgency_score);
  if (!Number.isFinite(score)) return null;
  return {
    status: x.status,
    urgency_score: Math.max(0, Math.min(100, Math.round(score))),
    emergency_type: typeof x.emergency_type === "string" ? x.emergency_type : null,
    needs: Array.isArray(x.needs) ? x.needs.filter((n: unknown) => typeof n === "string").slice(0, 10) : [],
    location_in_home: typeof x.location_in_home === "string" ? x.location_in_home : null,
    notes: typeof x.notes === "string" ? x.notes.slice(0, 1000) : "",
  };
}

// A need only counts when the caller says they LACK it ("out of ice", "power's out", "need a ride"),
// not when they mention it ("we have plenty of water").
const LACK = String.raw`(?:need|needs|out of|no|without|don'?t have|low on|running out of|ran out of|lost)\s+(?:\w+\s+){0,3}`;
const NEED_PATTERNS: [RegExp, string][] = [
  [new RegExp(`${LACK}(?:power|electricity)|power(?:'s| is| has been)? (?:out|off|gone)`, "i"), "power"],
  [new RegExp(`${LACK}(?:water|drinking water)`, "i"), "water"],
  [new RegExp(`${LACK}food`, "i"), "food"],
  [new RegExp(`${LACK}(?:medic\\w*|insulin|oxygen|prescriptions?|ice)|(?:insulin|medication|oxygen)[^.]{0,40}(?:cold|ice|power)`, "i"), "medication"],
  [new RegExp(`${LACK}(?:shelter|place to (?:stay|go))|somewhere to (?:go|stay)|(?:need|want) to evacuate`, "i"), "shelter"],
  [new RegExp(`${LACK}(?:ride|transport\\w*|car)|(?:could use|need) a ride`, "i"), "transportation"],
];
// Problems stated by the caller. A bare "no" is NOT a problem ("No, nobody is hurt").
const PROBLEM = /\b(not (?:really|safe|okay|ok|good)|isn'?t safe|unsafe|damage[ds]?|leak\w*|flood\w* (?:in|inside)|hurt|injur\w*|scared|getting cold|no heat|can'?t (?:leave|get out|reach))\b/i;
const NEGATED_PROBLEM = /\b(no(?:body| one)?|not|nothing)\b[^.?!]{0,20}\b(hurt|injur\w*|damage\w*)/gi;

function heuristicTriage(userText: string): TriageFields {
  const t = userText.toLowerCase();
  const needs = NEED_PATTERNS.filter(([re]) => re.test(t)).map(([, n]) => n);
  const problem = PROBLEM.test(t.replace(NEGATED_PROBLEM, ""));
  const status: TriageFields["status"] = needs.length || problem ? "needs_help" : "safe";
  return {
    status,
    urgency_score: status === "safe" ? 10 : 50,
    emergency_type: null,
    needs,
    location_in_home: null,
    notes: "Heuristic triage (Nemotron unavailable).",
  };
}

/**
 * Extracts structured triage from a conversation. `userText` = only the policyholder's words.
 * Safety override: any danger keyword forces `critical` regardless of what the model says.
 */
export async function extractTriage(
  ctx: Row, transcript: string, userText: string, alertId: Id, personId: Id,
): Promise<TriageFields> {
  const danger = detectDanger(userText);
  const llm = await chatJSON(
    `You are a disaster triage analyst. From the conversation, extract:
{"status": "safe"|"needs_help"|"critical", "urgency_score": 0-100, "emergency_type": string|null,
 "needs": string[], "location_in_home": string|null, "notes": "one or two sentences"}
critical = immediate danger to life RIGHT NOW (trapped, seriously injured, rising water inside, fire, gas, can't breathe,
  unresponsive person, life-support equipment about to fail).
needs_help = not in immediate danger but needs something (supplies, shelter, power, medication, transport, repairs).
safe = everyone okay and no unmet needs. Be skeptical: don't invent needs the caller didn't state.
urgency_score — use this scale strictly; most callers in a disaster are 10-50:
  0-15  safe, no needs
  20-40 minor or non-urgent needs (power out but okay, a few days of supplies, minor damage, anxious)
  45-65 needs help within a day or two (low on medication, can't stay long-term, needs transport soon)
  70-85 time-critical within ~12 hours for a vulnerable person (oxygen/dialysis/medical power running out,
        can't evacuate and home unsafe tonight, no safe place to sleep tonight with elderly/children)
  90-100 immediate danger to life (critical)
Insulin at room temperature lasts weeks — "no ice" alone is not time-critical.`,
    `Person context: ${JSON.stringify(ctx).slice(0, 3000)}\n\nConversation:\n${transcript.slice(0, 6000)}`,
    validateTriage,
  );
  const result = llm ?? heuristicTriage(userText);
  if (danger.danger) {
    result.status = "critical";
    result.urgency_score = Math.max(result.urgency_score, 90);
    result.notes = `[danger keywords: ${danger.matched.join(", ")}] ${result.notes}`.trim();
  }
  await logAgent({
    alertId, personId, agent: "triage", tool: "update_triage",
    thought: `${llm ? "Extracted" : "Heuristic"} triage → ${result.status} (${result.urgency_score})${danger.danger ? " — SAFETY OVERRIDE" : ""}`,
    input: { userText: userText.slice(0, 500) },
    output: result,
  });
  return result;
}

// ---------- text composition (remembers the call) ----------
/** Quote the most informative thing the person said on a previous call/text, if any. */
function lastUserStatement(ctx: Row): { text: string; channel: string } | null {
  const msgs = ctxHistory(ctx).filter((m) => (m.role ?? m.speaker) === "user" && (m.content ?? m.text));
  if (!msgs.length) return null;
  const best = [...msgs].reverse().find((m) => String(m.content ?? m.text).length > 12) ?? msgs[msgs.length - 1];
  return { text: String(best.content ?? best.text), channel: String(best.channel ?? "call") };
}

export async function composeOutreachText(ctx: Row, alertId: Id, personId: Id): Promise<string> {
  const prior = lastUserStatement(ctx);
  const event = ctxEventType(ctx);
  const llm = await chatText(
    `You write ONE SMS (max 300 chars) from the State Farm BEACON assistant to a policyholder during a ${event}.
If there was a previous call, reference what they said on it specifically ("On our call you said ...") and ask if it's still true.
Otherwise ask: are you and everyone in your home safe right now? Always end with: "If you're in immediate danger, call 911."
Output only the SMS text.`,
    `Name: ${ctxName(ctx)}\nPrevious conversation: ${JSON.stringify(ctxHistory(ctx)).slice(0, 3000)}`,
  );
  const valid = llm && llm.length <= 480 && /911/.test(llm) && (!prior || /call|said|told/i.test(llm));
  const text = valid
    ? llm!
    : prior
      ? `State Farm BEACON: On our ${prior.channel === "sms" ? "last text" : "call"} you said "${prior.text.slice(0, 120)}". Is that still the case? Reply SAFE if you're okay or HELP if you need assistance. If you're in immediate danger, call 911.`
      : `State Farm BEACON: we're checking on you during the ${event}. Are you and everyone in your home safe right now? Reply SAFE or HELP. If you're in immediate danger, call 911.`;
  await logAgent({
    alertId, personId, agent: "triage", tool: "compose_text",
    thought: valid ? "Composed follow-up text with Nemotron" : "Using template text" + (prior ? " referencing prior call" : ""),
    output: { text },
  });
  return text;
}

export async function composeReply(ctx: Row, triage: TriageFields): Promise<string> {
  if (triage.status === "critical") return `${EMERGENCY_LINE} We've also flagged your case for emergency responders.`;
  if (triage.status === "safe") return "Thank you — glad you're safe. We'll keep checking in. If anything changes, reply HELP or call 911.";
  const needs = triage.needs.length ? ` (${triage.needs.join(", ")})` : "";
  return `Thank you. We've logged that you need help${needs} and a State Farm responder will follow up. If you're in immediate danger, call 911.`;
}
