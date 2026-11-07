export const clock = (t: number) =>
  new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export const day = (t: number) =>
  new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' });

export const STATUS_LABEL = {
  safe: "I'm safe",
  saferoom: 'In my safe room',
  help: 'Asked for help',
  'no-response': 'No response',
} as const;

/** Reads after "You checked in ..." */
export const STATUS_PHRASE = {
  safe: 'as safe',
  saferoom: 'from your safe room',
  help: 'and asked for help',
  'no-response': 'without a response',
} as const;

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
