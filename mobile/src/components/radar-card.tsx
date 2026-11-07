import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { T } from '@/components/ui';
import { WeatherMap } from '@/components/weather-map';
import { DEFAULT_COORDS } from '@/lib/geocode';
import { activeAlerts, useStore } from '@/lib/store';
import { color, radius, space } from '@/lib/theme';

const LEGEND = ['#9BE08A', '#3CB043', '#F2D22E', '#F28C28', '#E0301E', '#B0179B'];

export function RadarLegend({ light }: { light?: boolean }) {
  const c = light ? 'rgba(255,255,255,0.85)' : color.inkSoft;
  return (
    <View style={st.legend}>
      <T v="caption" c={c}>
        Light rain
      </T>
      <View style={st.scale}>
        {LEGEND.map((hex) => (
          <View key={hex} style={{ flex: 1, backgroundColor: hex }} />
        ))}
      </View>
      <T v="caption" c={c}>
        Severe
      </T>
    </View>
  );
}

export function RadarCard() {
  const { state } = useStore();
  const lat = state.home.lat ?? DEFAULT_COORDS.lat;
  const lng = state.home.lng ?? DEFAULT_COORDS.lng;
  const warning = activeAlerts(state).some((a) => a.level === 'warning');

  return (
    <View style={{ marginTop: space.xl }}>
      <View style={st.head}>
        <T v="heading">Weather near home</T>
        <Pressable onPress={() => router.push('/weather')} hitSlop={10} accessibilityRole="button" style={st.expand}>
          <T v="smallStrong" c={color.red}>
            Full map
          </T>
          <Ionicons name="expand-outline" size={16} color={color.red} />
        </Pressable>
      </View>
      <Pressable onPress={() => router.push('/weather')} accessibilityLabel="Open full weather map" style={st.card}>
        <View style={st.map} pointerEvents="none">
          <WeatherMap lat={lat} lng={lng} warning={warning} />
        </View>
        <View style={st.foot}>
          <RadarLegend />
          <T v="caption" c={color.inkSoft} style={{ marginTop: space.xs }}>
            NOAA radar, updated every 5 minutes. {warning ? 'Red circle is the warning area.' : ''}
          </T>
        </View>
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: space.sm, paddingHorizontal: 2 },
  expand: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  card: { backgroundColor: color.white, borderRadius: radius.lg, overflow: 'hidden' },
  map: { height: 240, backgroundColor: '#E9ECEB' },
  foot: { padding: space.md, paddingHorizontal: space.lg },
  legend: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  scale: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden', flexDirection: 'row' },
});
