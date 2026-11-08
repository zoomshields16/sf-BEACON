// Expo push notifications (no SDK needed: one HTTPS call). Tokens look like ExponentPushToken[...].
export async function sendPush(tokens: string[], title: string, body: string, data: Record<string, unknown> = {}) {
  const to = tokens.filter((t) => /^Expo(nent)?PushToken\[/.test(t));
  if (!to.length) return 0;
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(to.map((t) => ({ to: t, title, body, data, sound: "default", priority: "high", interruptionLevel: "time-sensitive" }))),
  });
  if (!res.ok) throw new Error(`Expo push ${res.status}`);
  return to.length;
}
