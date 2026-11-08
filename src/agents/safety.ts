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
  ["breathing", /can'?t breathe|not breathing|trouble breathing|unconscious|unresponsive|passed out|can'?t (wake|rouse) (him|her|them|my \w+)( up)?|won'?t wake up|not waking up|(turning|turned|lips are|lips) blue|limp and|seizure|convuls\w*|stopped breathing/i],
  ["injury", /bleeding|badly hurt|seriously (hurt|injured)|broken (bone|leg|arm|hip)|chest pain|heart attack|stroke/i],
  // Water INSIDE or at a dangerous depth — not "water is up to the second step outside".
  ["water", /water('s| is)? (rising|coming in|coming into|pouring in)|water('s| is)? (up to|at|over) (my|our|his|her|their|the) (knees?|waist|chest|neck|shoulders|windows?|ceiling|first floor|second floor|door ?knob)|water (in|inside) the (house|home|living room|kitchen|bedroom)|flooding (in|inside)|swept/i],
  ["structure", /roof (collapsed|caved|caving)|house (collapsed|is collapsing)|ceiling fell/i],
  ["fire", /(house|home|kitchen|room) (is )?on fire|fire (inside|in the house)|flames (inside|in the house)/i],
  ["gas", /smell(s)? gas|gas leak/i],
  // DIRECT asks only. A bare "emergency" or "help me" is NOT here: callers say "what emergency?" after our own opening line
  // ("…the emergency in your area") and used to get hung up on. Those go to the clarifying-question path in CallBrain.
  ["direct_ask", /\b(send (help|someone|an ambulance|paramedics|the police)|call (911|nine[- ]?one[- ]?one|an ambulance|the police|the fire department)|(i|we) need (an |the )?(ambulance|paramedics?|police|fire department|911)|we'?re dying|someone is dying)\b/i],
];

/** Vague distress: the caller says there is an emergency / asks for help, without a direct ask or a specific life threat. */
export const VAGUE_DISTRESS = /\b(emergenc(y|ies)|help me|i need help|we need help)\b/i;

// "Nobody is trapped" / "no one is bleeding" must not count as danger. A match is negated when a negation word sits in the
// same clause, within 4 words before it. Clauses break at punctuation, newlines and but/and/however, so
// "no one is hurt but we're trapped" and "No! The water is rising" still trigger. "can't" is deliberately NOT a negation
// ("can't breathe" is itself a danger phrase).
// Bare "no" is usually an answer ("No — the water is rising"), so it only negates when it's the word right before the
// danger phrase ("no water coming in"). Other negations count within 2 words ("nobody is trapped", "we're not trapped").
// When in doubt we keep the danger — every escalation is reviewed by a human, a missed emergency is not.
const NEGATION = /\b(not|nobody|none|never|nothing|without|neither|nor|isn'?t|aren'?t|wasn'?t|weren'?t|don'?t|doesn'?t|didn'?t|haven'?t|hasn'?t|ain'?t|no one)\b/i;
const CLAUSE_BREAK = /[.!?,;\n]|\b(?:but|and|however|though|although|except)\b/i;

function negated(text: string, index: number): boolean {
  const clause = text.slice(0, index).split(new RegExp(CLAUSE_BREAK.source, "gi")).pop() ?? "";
  const words = clause.trim().split(/\s+/).filter(Boolean);
  if (words.length && /^no$/i.test(words[words.length - 1])) return true;          // "no water coming in"
  // "no one is bleeding": "no one" sits 3 words back, so it gets a slightly wider window than the other negations.
  return NEGATION.test(words.slice(-2).join(" ")) || /\bno one\b/i.test(words.slice(-3).join(" "));
}

/** True if `re` matches somewhere in `text` that isn't negated ("it's not an emergency" → false). */
// A danger that the same sentence says is already OVER ("was trapped earlier but they got her out", "rescued",
// "everyone's safe now") is not a current emergency. Kept narrow on purpose: "my son was swept away" still triggers.
const RESOLVED = /\b(got (her|him|them|us|me) out|pulled (her|him|them|us|me) out|(was|were|got) rescued|rescued (her|him|them|us|me)|(is|are|'s|'re) (safe|fine|okay|out) now|no longer (trapped|stuck|in danger))\b/i;
function sentenceAt(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf(".", index), text.lastIndexOf("!", index), text.lastIndexOf("?", index)) + 1;
  const rest = text.slice(index).search(/[.!?]/);
  return text.slice(start, rest < 0 ? undefined : index + rest);
}

export const matchUnnegated = (re: RegExp, text: string) =>
  [...text.matchAll(new RegExp(re.source, re.flags.replace("g", "") + "g"))]
    .some((m) => !negated(text, m.index ?? 0) && !RESOLVED.test(sentenceAt(text, m.index ?? 0)));

export function detectDanger(userText: string): { danger: boolean; matched: string[] } {
  const matched = DANGER_PATTERNS.filter(([, re]) => matchUnnegated(re, userText)).map(([k]) => k);
  return { danger: matched.length > 0, matched };
}

// Nemotron's danger flag only counts if the caller's words (or the model's stated reason) name a CONCRETE life threat.
// "Lots of water around and thunder" is weather, not an emergency — the model alone must not trigger the 911 line.
const LIFE_THREAT = /\b(trapped|stuck|can'?t get out|pinned|injur\w*|hurt (badly|bad)|badly hurt|bleed\w*|blood|breath\w*|unconscious|unresponsive|not respond\w*|isn'?t (answering|responding|moving)|collaps\w*|passed out|faint\w*|chest pain|heart attack|stroke|seizure|drown\w*|swept|fell|fallen|can'?t (move|get up|walk)|fire|flames|smoke|gas|roof|ceiling|structure|oxygen|ventilator|dialysis|life.?support|electrocut\w*|power line|send help|help me|emergency|dying|water (is )?(inside|in the (house|home|room|living room|kitchen|bedroom)|coming in|rising|pouring)|flood\w* (inside|in the house))\b/i;

export function isConcreteThreat(...texts: (string | undefined)[]): boolean {
  return texts.some((t) => Boolean(t) && LIFE_THREAT.test(t!));
}

// The agent must never imply rescue is coming — only a human responder can promise that.
const FALSE_PROMISES = /\s*[^.!?]*\b(help is (on (the|its) way|coming)|until help arrives|(responders|rescuers|someone|help|they)('s| is| are| will be)? (on (the|their|its) way|coming to you|being sent|be there soon)|we('re| are| will be)? (sending|dispatching) (help|someone|responders)|help will (arrive|be there))\b[^.!?]*[.!?]?/gi;

/** Removes any sentence that promises help is coming. Falls back to a neutral line if nothing is left. */
export function stripFalsePromises(text: string): string {
  const cleaned = text.replace(FALSE_PROMISES, "").replace(/\s{2,}/g, " ").trim();
  return cleaned || "Thank you.";
}
