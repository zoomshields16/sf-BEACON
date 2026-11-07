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

export function detectDanger(userText: string): { danger: boolean; matched: string[] } {
  const matched = DANGER_PATTERNS.filter(([, re]) => re.test(userText)).map(([k]) => k);
  return { danger: matched.length > 0, matched };
}
