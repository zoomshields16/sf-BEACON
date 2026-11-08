import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, ReactNode, useContext, useEffect, useReducer, useRef, useState } from 'react';

import { register, sendCheckIn, syncAlerts } from './api';
import { getPushToken, preciseLocation } from './device';
import type { Hazard } from './hazards';
import { HomeProfile, suggestionsFor } from './plan';
import { HAZARDS } from './hazards';

// ---------- Types (these mirror what the backend will eventually send/receive) ----------

export type SafeRoom = {
  hazard: Hazard;
  room: string;
  floor: string;
  notes: string;
};

export type Contact = { id: string; name: string; relation: string; phone: string };

export type CheckInStatus = 'safe' | 'saferoom' | 'help' | 'no-response';

export type Alert = {
  id: string;
  hazard: Hazard;
  level: 'warning' | 'watch';
  title: string;
  area: string;
  source: string; // e.g. "National Weather Service"
  issuedAt: number;
  expiresAt: number;
  instructions: string;
  /** Neighborhood grid summary (from crowd-sourced check-ins). */
  neighborhood?: { checkedIn: number; total: number; reportingDamage: number };
  checkIn?: { status: CheckInStatus; at: number };
};

export type AppState = {
  onboarded: boolean;
  user: { name: string; email: string; phone: string };
  policy: { linked: boolean; number: string; type: string };
  home: {
    street: string;
    city: string;
    state: string;
    zip: string;
    county: string;
    homeType: string;
    accessNotes: string;
    lat?: number;
    lng?: number;
    profileDone: boolean;
  } & HomeProfile;
  household: { adults: number; children: number; pets: number; needs: string };
  safeRooms: SafeRoom[];
  contacts: Contact[];
  settings: { criticalAlerts: boolean; voiceCallBackup: boolean; shareWithResponders: boolean };
  alerts: Alert[];
};

// ---------- Defaults ----------

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

export const emptyState: AppState = {
  onboarded: false,
  user: { name: '', email: '', phone: '' },
  policy: { linked: false, number: '', type: '' },
  home: {
    street: '',
    city: '',
    state: '',
    zip: '',
    county: '',
    homeType: 'Single-family house',
    accessNotes: '',
    profileDone: false,
    floors: 1,
    hasBasement: false,
    hasStormShelter: false,
    hasAtticAccess: false,
    hasGarage: false,
    interiorRooms: [],
  },
  household: { adults: 1, children: 0, pets: 0, needs: '' },
  safeRooms: [],
  contacts: [],
  settings: { criticalAlerts: true, voiceCallBackup: true, shareWithResponders: true },
  alerts: [
    {
      id: 'past-1',
      hazard: 'flood',
      level: 'watch',
      title: 'Flash flood watch',
      area: 'Dallas County',
      source: 'National Weather Service',
      issuedAt: Date.now() - 9 * DAY,
      expiresAt: Date.now() - 8 * DAY,
      instructions: 'Be ready to move to higher ground if a warning is issued.',
      checkIn: { status: 'safe', at: Date.now() - 9 * DAY + HOUR },
    },
    {
      id: 'past-2',
      hazard: 'tornado',
      level: 'watch',
      title: 'Tornado watch',
      area: 'Dallas and Collin counties',
      source: 'National Weather Service',
      issuedAt: Date.now() - 23 * DAY,
      expiresAt: Date.now() - 23 * DAY + 6 * HOUR,
      instructions: 'Conditions are right for tornadoes. Know where your safe room is.',
    },
  ],
};

/** Data the "Connect with State Farm" mock returns. Swap for the real policy API later. */
export const MOCK_POLICY_PULL = {
  policy: { linked: true, number: 'HO-48-2210-4821', type: 'Homeowners' },
  home: {
    street: '2401 Elm Street',
    city: 'Richardson',
    state: 'TX',
    zip: '75080',
    county: 'Dallas County',
    homeType: 'Single-family house',
    lat: 32.9483,
    lng: -96.7299,
  },
};

export function makeTestAlert(): Alert {
  const now = Date.now();
  return {
    id: `test-${now}`,
    hazard: 'tornado',
    level: 'warning',
    title: 'Tornado warning',
    area: 'Richardson and north Dallas County',
    source: 'National Weather Service',
    issuedAt: now,
    expiresAt: now + 45 * 60 * 1000,
    instructions: 'A tornado has been reported near your home. Take shelter now.',
    neighborhood: { checkedIn: 41, total: 58, reportingDamage: 3 },
  };
}

// ---------- Reducer ----------

type Action =
  | { type: 'hydrate'; state: AppState }
  | { type: 'patch'; patch: Partial<AppState> }
  | { type: 'user'; patch: Partial<AppState['user']> }
  | { type: 'home'; patch: Partial<AppState['home']> }
  | { type: 'household'; patch: Partial<AppState['household']> }
  | { type: 'settings'; patch: Partial<AppState['settings']> }
  | { type: 'linkPolicy' }
  | { type: 'unlinkPolicy' }
  | { type: 'saveRoom'; room: SafeRoom }
  | { type: 'removeRoom'; hazard: Hazard }
  | { type: 'saveContact'; contact: Contact }
  | { type: 'removeContact'; id: string }
  | { type: 'triggerAlert'; alert: Alert }
  | { type: 'checkIn'; alertId: string; status: CheckInStatus }
  | { type: 'endAlert'; alertId: string }
  | { type: 'suggestRooms' }
  | { type: 'serverAlerts'; alerts: Alert[] }
  | { type: 'reset' };

function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'hydrate':
      return a.state;
    case 'patch':
      return { ...s, ...a.patch };
    case 'user':
      return { ...s, user: { ...s.user, ...a.patch } };
    case 'home':
      return { ...s, home: { ...s.home, ...a.patch } };
    case 'household':
      return { ...s, household: { ...s.household, ...a.patch } };
    case 'settings':
      return { ...s, settings: { ...s.settings, ...a.patch } };
    case 'linkPolicy':
      return {
        ...s,
        policy: MOCK_POLICY_PULL.policy,
        home: s.home.street ? s.home : { ...s.home, ...MOCK_POLICY_PULL.home },
      };
    case 'unlinkPolicy':
      return { ...s, policy: { linked: false, number: '', type: '' } };
    case 'saveRoom':
      return { ...s, safeRooms: [...s.safeRooms.filter((r) => r.hazard !== a.room.hazard), a.room] };
    case 'removeRoom':
      return { ...s, safeRooms: s.safeRooms.filter((r) => r.hazard !== a.hazard) };
    case 'saveContact': {
      const exists = s.contacts.some((c) => c.id === a.contact.id);
      return {
        ...s,
        contacts: exists ? s.contacts.map((c) => (c.id === a.contact.id ? a.contact : c)) : [...s.contacts, a.contact],
      };
    }
    case 'removeContact':
      return { ...s, contacts: s.contacts.filter((c) => c.id !== a.id) };
    case 'triggerAlert':
      // Only one live test alert at a time.
      return {
        ...s,
        alerts: [
          a.alert,
          ...s.alerts.map((x) => (x.expiresAt > Date.now() ? { ...x, expiresAt: Date.now() - 1 } : x)),
        ],
      };
    case 'checkIn':
      return {
        ...s,
        alerts: s.alerts.map((x) => (x.id === a.alertId ? { ...x, checkIn: { status: a.status, at: Date.now() } } : x)),
      };
    case 'endAlert':
      return { ...s, alerts: s.alerts.map((x) => (x.id === a.alertId ? { ...x, expiresAt: Date.now() - 1 } : x)) };
    case 'suggestRooms': {
      // Fill any hazard without a room using the best match for this home. Never overwrites the user's picks.
      const added = HAZARDS.filter((h) => !s.safeRooms.some((r) => r.hazard === h.id)).flatMap((h) => {
        const best = suggestionsFor(s.home, h.id)[0];
        return best ? [{ hazard: h.id, room: best.room, floor: best.floor, notes: '' }] : [];
      });
      return { ...s, safeRooms: [...s.safeRooms, ...added] };
    }
    case 'serverAlerts': {
      // Alerts from the BEACON backend replace the ones we got last time; ones that vanished have ended.
      const incoming = new Map(a.alerts.map((x) => [x.id, x]));
      const kept = s.alerts.flatMap((x) => {
        if (!x.id.startsWith('srv-')) return [x];
        return incoming.has(x.id) ? [] : [{ ...x, expiresAt: Math.min(x.expiresAt, Date.now() - 1) }];
      });
      const fresh = a.alerts.map((x) => ({ ...x, checkIn: s.alerts.find((o) => o.id === x.id)?.checkIn }));
      return { ...s, alerts: [...fresh, ...kept] };
    }
    case 'reset':
      return emptyState;
  }
}

// ---------- Provider ----------

const KEY = 'beacon/state/v2';

type Ctx = { state: AppState; dispatch: (a: Action) => void; ready: boolean };
const StoreContext = createContext<Ctx | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, rawDispatch] = useReducer(reducer, emptyState);
  const [ready, setReady] = useState(false);
  const latest = useRef(state);
  latest.current = state;

  // Check-ins on backend alerts are also sent to the server (the 30 s timeout asks it to place the safety call).
  const dispatch = (a: Action) => {
    rawDispatch(a);
    if (a.type !== 'checkIn' || !a.alertId.startsWith('srv-')) return;
    const { user, alerts, safeRooms } = latest.current;
    const al = alerts.find((x) => x.id === a.alertId);
    const room = al && safeRooms.find((r) => r.hazard === al.hazard)?.room;
    const status = a.status === 'saferoom' ? 'saferoom' : a.status;
    if (user.phone) preciseLocation().then((loc) => sendCheckIn(user.phone, Number(a.alertId.slice(4)), status, room, loc)).catch(() => {});
  };

  // Tell the backend who this is (creates the policyholder) whenever the profile changes.
  const h = state.home, hh = state.household;
  const profileKey = JSON.stringify([state.user.name, state.user.phone, h.street, h.city, h.lat, h.lng, hh, state.safeRooms[0]?.room]);
  useEffect(() => {
    if (!ready || !state.onboarded || !state.user.phone || h.lat == null || h.lng == null) return;
    getPushToken()
      .then((pushToken) =>
        register({
          name: state.user.name, phone: state.user.phone, address: fullAddress(h), lat: h.lat!, lng: h.lng!,
          adults: hh.adults, children: hh.children, pets: hh.pets, needs: hh.needs, safeRoom: state.safeRooms[0]?.room, pushToken,
        }),
      )
      .catch(() => {});
  }, [ready, state.onboarded, profileKey]);

  // Poll the backend for alerts covering this person's home.
  useEffect(() => {
    if (!ready || !state.user.phone) return;
    let stop = false;
    const tick = () =>
      syncAlerts(state.user.phone)
        .then((r) => !stop && r.linked && rawDispatch({ type: 'serverAlerts', alerts: r.alerts }))
        .catch(() => {});
    tick();
    const id = setInterval(tick, 5000);
    return () => { stop = true; clearInterval(id); };
  }, [ready, state.user.phone]);

  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (raw) {
          const saved = JSON.parse(raw);
          rawDispatch({ type: 'hydrate', state: { ...emptyState, ...saved, home: { ...emptyState.home, ...saved.home } } });
        }
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    if (ready) AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {});
  }, [state, ready]);

  return <StoreContext.Provider value={{ state, dispatch, ready }}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used inside StoreProvider');
  return ctx;
}

// ---------- Selectors ----------

export const activeAlerts = (s: AppState) => s.alerts.filter((a) => a.expiresAt > Date.now());
export const pastAlerts = (s: AppState) => s.alerts.filter((a) => a.expiresAt <= Date.now());
export const roomFor = (s: AppState, h: Hazard) => s.safeRooms.find((r) => r.hazard === h);

export function readiness(s: AppState) {
  const items = [
    { label: 'Home address added', done: !!s.home.street },
    { label: 'Home details answered', done: s.home.profileDone },
    { label: 'Safe room for every disaster', done: s.safeRooms.length >= HAZARDS.length },
    { label: 'Household details added', done: s.household.adults > 0 },
    { label: 'Emergency contact added', done: s.contacts.length > 0 },
    { label: 'Access notes for responders', done: !!s.home.accessNotes },
  ];
  return { items, done: items.filter((i) => i.done).length, total: items.length };
}

export const fullAddress = (h: AppState['home']) =>
  h.street ? `${h.street}, ${h.city}, ${h.state} ${h.zip}` : 'No address yet';
