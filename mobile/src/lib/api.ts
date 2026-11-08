// BEACON backend client. On a real phone set EXPO_PUBLIC_API_URL to your computer's LAN address, e.g. http://192.168.1.20:3000
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_URL}/api/mobile${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

export type SyncResult = { linked: boolean; alerts: any[] };
export const syncAlerts = (phone: string) => post<SyncResult>('/sync', { phone });
export const sendCheckIn = (phone: string, serverAlertId: number, status: string, room?: string, loc?: { lat: number; lng: number } | null) =>
  post("/checkin", { phone, alertId: serverAlertId, status, room, ...loc });

export type Registration = {
  name: string; phone: string; address: string; lat: number; lng: number;
  adults: number; children: number; pets: number; needs: string; safeRoom?: string; pushToken?: string | null;
};
export const register = (r: Registration) => post('/register', r);

/** "(972) 555-0111" → "+19725550111"; null if it isn't a full US number. */
export const toE164 = (p: string) => {
  const d = p.replace(/[^0-9]/g, '');
  return d.length === 10 ? '+1' + d : d.length === 11 && d[0] === '1' ? '+' + d : null;
};
