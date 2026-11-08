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
export const sendCheckIn = (phone: string, serverAlertId: number, status: string, room?: string) =>
  post('/checkin', { phone, alertId: serverAlertId, status, room });
