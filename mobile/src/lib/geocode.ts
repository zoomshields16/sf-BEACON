import * as Location from 'expo-location';

import type { AppState } from './store';

/** Fallback when geocoding isn't available (web preview, no network). Richardson, TX. */
export const DEFAULT_COORDS = { lat: 32.9483, lng: -96.7299 };

/**
 * Turns the registered address into map coordinates using the phone's built-in geocoder.
 * This reads the typed address only — it never asks for or uses the phone's GPS location.
 */
export async function geocodeHome(h: AppState['home']): Promise<{ lat: number; lng: number } | null> {
  if (!h.street) return null;
  try {
    const [hit] = await Location.geocodeAsync(`${h.street}, ${h.city}, ${h.state} ${h.zip}`);
    return hit ? { lat: hit.latitude, lng: hit.longitude } : null;
  } catch {
    return null;
  }
}
