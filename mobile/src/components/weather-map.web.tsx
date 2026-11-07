// Web preview stand-in: react-native-maps only runs on iOS/Android.
import { StyleSheet, View } from 'react-native';

import { T } from '@/components/ui';
import { color } from '@/lib/theme';

import type { WeatherMapProps } from './weather-map';

export const RADAR_REFRESH_MS = 5 * 60 * 1000;

export function WeatherMap({ warning }: WeatherMapProps) {
  return (
    <View style={[StyleSheet.absoluteFill, st.wrap]}>
      <View style={[st.blob, { width: 220, height: 140, left: -30, top: 30, backgroundColor: 'rgba(76,175,80,0.45)' }]} />
      <View style={[st.blob, { width: 140, height: 90, left: 40, top: 60, backgroundColor: 'rgba(255,193,7,0.55)' }]} />
      <View style={[st.blob, { width: 60, height: 40, left: 90, top: 85, backgroundColor: 'rgba(214,35,17,0.6)' }]} />
      {warning ? <View style={st.warn} /> : null}
      <View style={st.pinRing}>
        <View style={st.pin} />
      </View>
      <T v="caption" c={color.inkSoft} style={st.note}>
        Live radar shows on iPhone
      </T>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { backgroundColor: '#E9ECEB', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  blob: { position: 'absolute', borderRadius: 999 },
  warn: { position: 'absolute', width: 150, height: 150, borderRadius: 75, borderWidth: 2, borderColor: color.red, backgroundColor: 'rgba(214,35,17,0.12)' },
  pinRing: { width: 22, height: 22, borderRadius: 11, backgroundColor: color.white, alignItems: 'center', justifyContent: 'center' },
  pin: { width: 12, height: 12, borderRadius: 6, backgroundColor: color.red },
  note: { position: 'absolute', bottom: 8, right: 10 },
});
