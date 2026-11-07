import type { Hazard } from './hazards';

/** Answers from the house setup questions. Drives safe room suggestions. */
export type HomeProfile = {
  floors: number; // above-ground floors
  hasBasement: boolean;
  hasStormShelter: boolean;
  hasAtticAccess: boolean; // attic with a window or roof hatch you can get out of
  hasGarage: boolean;
  interiorRooms: string[]; // windowless rooms on the ground floor, e.g. "Hall closet"
};

export const INTERIOR_ROOM_OPTIONS = ['Hall closet', 'Bathroom', 'Hallway', 'Pantry', 'Laundry room', 'Under the stairs'];

export type Spot = { room: string; floor: string };

export function floorName(n: number) {
  return ['Ground floor', 'First floor', 'Second floor', 'Third floor', 'Fourth floor'][n] ?? `Floor ${n}`;
}

/** Floors a person could pick for a custom room, based on the house. */
export function floorsFor(p: HomeProfile) {
  const list: string[] = [];
  if (p.hasBasement) list.push('Basement');
  for (let i = 1; i <= Math.max(1, p.floors); i++) list.push(floorName(i));
  if (p.hasAtticAccess) list.push('Attic');
  list.push('Outside');
  return list;
}

const uniq = (spots: Spot[]) => spots.filter((s, i) => spots.findIndex((x) => x.room === s.room) === i);

/** Best-first list of spots for a hazard, built only from what this home actually has. */
export function suggestionsFor(p: HomeProfile, hazard: Hazard): Spot[] {
  const ground = floorName(1);
  const interior = p.interiorRooms.map((r) => ({ room: r, floor: ground }));
  const top = floorName(Math.max(1, p.floors));

  switch (hazard) {
    case 'tornado':
      return uniq([
        ...(p.hasStormShelter ? [{ room: 'Storm shelter', floor: 'Outside' }] : []),
        ...(p.hasBasement ? [{ room: 'Basement', floor: 'Basement' }] : []),
        ...interior,
        ...(interior.length ? [] : [{ room: 'Interior hallway', floor: ground }]),
      ]).slice(0, 4);
    case 'hurricane':
      return uniq([
        ...(p.hasStormShelter ? [{ room: 'Storm shelter', floor: 'Outside' }] : []),
        ...interior,
        ...(interior.length ? [] : [{ room: 'Interior hallway', floor: ground }]),
      ]).slice(0, 4);
    case 'flood':
      return uniq([
        ...(p.floors >= 2 ? [{ room: 'Upstairs bedroom', floor: top }, { room: 'Upstairs landing', floor: top }] : []),
        ...(p.hasAtticAccess ? [{ room: 'Attic with roof access', floor: 'Attic' }] : []),
        { room: 'Leave early for higher ground', floor: 'Outside' },
      ]).slice(0, 4);
    case 'wildfire':
      return uniq([
        ...(p.hasGarage ? [{ room: 'Out through the garage', floor: 'Outside' }] : []),
        { room: 'Out the front door', floor: 'Outside' },
        { room: 'Out the back door', floor: 'Outside' },
      ]);
    case 'earthquake':
      return uniq([
        { room: 'Under a sturdy table', floor: ground },
        ...interior.filter((r) => r.room === 'Hallway'),
        { room: 'Against an interior wall', floor: ground },
      ]).slice(0, 4);
  }
}

/** "Hall closet, first floor" — but just "Basement" or "Out the front door" when the floor adds nothing. */
export function describeSpot(room: string, floor?: string) {
  if (!floor || floor === 'Outside' || floor.toLowerCase() === room.toLowerCase()) return room;
  return `${room}, ${floor.toLowerCase()}`;
}
