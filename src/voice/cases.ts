// Call edge cases handled in code (no model involved), so they work even when Nemotron is down.
// classify() only sees what the CALLER said. Danger is checked before this in CallBrain, so it always wins.
import { EMERGENCY_LINE } from "../agents/safety.js";

export type CallCase = "voicemail" | "wrong_person" | "opt_out" | "callback" | "language" | "ai_question" | "help_question";

/** How a call ended; sent to the API as `outcome`. */
export type CallOutcome = "completed" | "hangup" | CallCase | "silent" | "no_answer";

// Cases that only make sense at the very start of a call (a voicemail greeting, "wrong number").
// Later in the call the same words are ordinary answers ("clean water is not available here").
const EARLY_ONLY: CallCase[] = ["voicemail", "wrong_person"];

const CASES: [CallCase, RegExp][] = [
  ["opt_out", /stop (calling|contacting)|(don'?t|do not) (call|contact|text) (me )?(again|anymore|any more)?|take me off|remove (me|my number)|unsubscribe/i],
  ["voicemail", /leave (a|your) message|after the (tone|beep)|voice ?mail|mailbox|(is|am|are) not available (right now|to take your call)|the (number|person) you (have )?(dialed|are calling)|can'?t (come to|get to) the phone|please record/i],
  ["wrong_person", /wrong number|wrong person|no ?one (here )?(by|with) that name|(nobody|no one) by that name|doesn'?t live here|you have the wrong/i],
  ["language", /(don'?t|do not|no) (speak|understand) (any )?english|no hablo|habla espa|en español|speak (spanish|chinese|vietnamese|korean|arabic)/i],
  ["callback", /call (me )?back( later)?|call (me )?later|(is|it'?s) not a good time( to talk)?|(this is|it'?s) (a )?bad time to talk|i'?m busy right now|in a meeting|can you try again later/i],
  ["ai_question", /(are|r) you (a |an )?(robot|real person|human|bot|machine|ai|recording|computer)|is this (a |an )?(scam|spam|recording|robot|robocall)/i],
  ["help_question", /(when|how long).{0,30}(help|someone|anyone|they).{0,20}(come|coming|arrive|get here|be here)|is (help|anyone|someone) (coming|on the way)/i],
];

/** `callerTurn` = 1 for the caller's first reply. Voicemail / wrong-person only count on that first reply. */
export function classify(callerText: string, callerTurn = 1): CallCase | null {
  return CASES.find(([k, re]) => (callerTurn <= 1 || !EARLY_ONLY.includes(k)) && re.test(callerText))?.[0] ?? null;
}

const SAFE_TAIL = `If anyone is in danger, ${EMERGENCY_LINE.toLowerCase()}`;

/** `ends` = hang up after saying it; otherwise the brain repeats the current question after `say`. */
export const CASE_REPLIES: Record<CallCase, { say: string; ends: boolean }> = {
  voicemail: { say: "", ends: true }, // hang up silently — we never leave a message
  wrong_person: { say: `Sorry about that, thank you. ${SAFE_TAIL}`, ends: true },
  opt_out: { say: `Understood, we will not call again. ${SAFE_TAIL}`, ends: true },
  callback: { say: `No problem, thank you for picking up. ${SAFE_TAIL}`, ends: true },
  language: {
    say: `I'm sorry, I can only help in English right now. A State Farm representative will follow up with you. ${SAFE_TAIL}`,
    ends: true,
  },
  ai_question: {
    say: "I'm an automated assistant calling for State Farm to check on your safety. I will never ask for payment or personal information.",
    ends: false,
  },
  help_question: {
    say: `I can't send help myself and I can't promise when it will arrive. ${SAFE_TAIL} I'm passing what you tell me to the State Farm response team.`,
    ends: false,
  },
};

// Silence handling
export const SILENCE_REMINDERS = 2;
export const SILENCE_GIVEUP = `I'm not hearing anything, so I'll hang up. ${SAFE_TAIL} Goodbye.`;
