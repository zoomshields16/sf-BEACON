// Phone-side pieces for the backend link: push token, precise location, tapping a notification.
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

/** Expo push token, or null (simulator, permission denied, web). Asks for permission on first call. */
export async function getPushToken(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null;
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') return null;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    return (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  } catch (e) {
    console.warn('[beacon] no push token:', e);
    return null;
  }
}

/** The phone's precise position right now (falls back to the last known one). Only used when sending a check-in. */
export async function preciseLocation(): Promise<{ lat: number; lng: number } | null> {
  try {
    let { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') status = (await Location.requestForegroundPermissionsAsync()).status;
    if (status !== 'granted') return null;
    const p = (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync({}));
    return { lat: p.coords.latitude, lng: p.coords.longitude };
  } catch {
    return null;
  }
}
