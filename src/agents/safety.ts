// Fixed safety behavior. Nothing here depends on Nemotron, so it works even when the API is down.

export const CORE_QUESTIONS = [
  "Are you and everyone in your home safe right now?",
  "Is anyone injured?",
  "Is your home safe to stay in tonight?",
] as const;

export const EMERGENCY_LINE = "Please hang up and call 911 now.";

const FALLBACK_FOLLOWUPS: Record<string, string[]> = {
  flood: [
    "Is water inside your home, and is it rising?",
    "Can you get to a higher floor or a safe place if you need to?",
    "Does anyone in your home need medication or medical equipment that needs power?",
  ],
  hurricane: [
    "Has your home lost power or been damaged by wind or water?",
    "Do you have enough water, food, and medication for the next 72 hours?",
    "Do you need help evacuating?",
  ],
  tornado: [
    "Is your home damaged, or is anyone trapped?",
    "Do you smell gas or see downed power lines nearby?",
    "Do you have a safe place to stay tonight?",
  ],
  wildfire: [
    "Can you see smoke or flames near your home?",
    "Are you able to evacuate right now if you're told to?",
    "Is anyone having trouble breathing because of smoke?",
  ],
  winter: [
    "Do you have heat in your home right now?",
    "Has your power or water been cut off?",
    "Does anyone in your home need medication or medical equipment that needs power?",
  ],
  default: [
    "Has your home been damaged?",
    "Do you have power, water, and any medications you need?",
    "Do you need help leaving your home?",
  ],
};

export function disasterKey(eventType: string): keyof typeof FALLBACK_FOLLOWUPS {
  const e = eventType.toLowerCase();
  if (/flood|surge/.test(e)) return "flood";
  if (/hurricane|tropical/.test(e)) return "hurricane";
  if (/tornado|severe thunderstorm/.test(e)) return "tornado";
  if (/fire|red flag/.test(e)) return "wildfire";
  if (/winter|ice|freeze|blizzard|cold/.test(e)) return "winter";
  return "default";
}

export const fallbackFollowups = (eventType: string) => FALLBACK_FOLLOWUPS[disasterKey(eventType)];

// Scan ONLY what the policyholder said (never the agent's questions).
// We accept false positives on purpose; every escalation goes to human review first.
const DANGER_PATTERNS: [string, RegExp][] = [
  ["trapped", /\b(trapped|stuck|can'?t get out|pinned)\b/i],
  ["breathing", /can'?t breathe|not breathing|trouble breathing|unconscious|unresponsive|passed out/i],
  ["injury", /bleeding|badly hurt|seriously (hurt|injured)|broken (bone|leg|arm|hip)|chest pain|heart attack|stroke/i],
  ["water", /water('s| is)? (rising|coming in|up to)|flooding (in|inside)|swept/i],
  ["structure", /roof (collapsed|caved|caving)|house (collapsed|is collapsing)|ceiling fell/i],
  ["fire", /(house|home|kitchen|room) (is )?on fire|fire (inside|in the house)|flames (inside|in the house)/i],
  ["gas", /smell(s)? gas|gas leak/i],
  ["explicit", /\b(help me|send help|emergency|we'?re dying|someone is dying)\b/i],
];

// "Nobody is trapped" / "no one is bleeding" must not count as danger. A match is negated when a negation word sits in the
// same clause, within 4 words before it. Clauses break at punctuation, newlines and but/and/however, so
// "no one is hurt but we're trapped" and "No! The water is rising" still trigger. "can't" is deliberately NOT a negation
// ("can't breathe" is itself a danger phrase).
const NEGATION = /\b(no|not|nobody|none|never|nothing|without|neither|nor|isn'?t|aren'?t|wasn'?t|weren'?t|don'?t|doesn'?t|didn'?t|haven'?t|hasn'?t|ain'?t)\b/i;
const CLAUSE_BREAK = /[.!?,;\n]|\b(?:but|and|however|though|although|except)\b/i;

function negated(text: string, index: number): boolean {
  const clause = text.slice(0, index).split(new RegExp(CLAUSE_BREAK.source, "gi")).pop() ?? "";
  return NEGATION.test(clause.trim().split(/\s+/).slice(-4).join(" "));
}

export function detectDanger(userText: string): { danger: boolean; matched: string[] } {
  const matched = DANGER_PATTERNS
    .filter(([, re]) => [...userText.matchAll(new RegExp(re.source, re.flags.replace("g", "") + "g"))].some((m) => !negated(userText, m.index ?? 0)))
    .map(([k]) => k);
  return { danger: matched.length > 0, matched };
}

// The agent must never imply rescue is coming — only a human responder can promise that.
const FALSE_PROMISES = /\s*[^.!?]*\b(help is (on (the|its) way|coming)|until help arrives|(responders|rescuers|someone|help|they)('s| is| are| will be)? (on (the|their|its) way|coming to you|being sent|be there soon)|we('re| are| will be)? (sending|dispatching) (help|someone|responders)|help will (arrive|be there))\b[^.!?]*[.!?]?/gi;

/** Removes any sentence that promises help is coming. Falls back to a neutral line if nothing is left. */
export function stripFalsePromises(text: string): string {
  const cleaned = text.replace(FALSE_PROMISES, "").replace(/\s{2,}/g, " ").trim();
  return cleaned || "Thank you.";
}
