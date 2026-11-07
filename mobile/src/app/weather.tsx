import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RadarLegend } from '@/components/radar-card';
import { T } from '@/components/ui';
import { WeatherMap } from '@/components/weather-map';
import { DEFAULT_COORDS } from '@/lib/geocode';
import { activeAlerts, useStore } from '@/lib/store';
import { color, radius, space } from '@/lib/theme';

export default function WeatherScreen() {
  const insets = useSafeAreaInsets();
  const { state } = useStore();
  const alert = activeAlerts(state)[0];

  return (
    <View style={{ flex: 1, backgroundColor: color.ink }}>
      <WeatherMap
        lat={state.home.lat ?? DEFAULT_COORDS.lat}
        lng={state.home.lng ?? DEFAULT_COORDS.lng}
        warning={alert?.level === 'warning'}
        interactive
        zoom="region"
      />

      <View style={[st.top, { paddingTop: insets.top + space.sm }]} pointerEvents="box-none">
        <Pressable onPress={() => router.back()} style={st.close} accessibilityLabel="Close map" accessibilityRole="button">
          <Ionicons name="close" size={22} color={color.ink} />
        </Pressable>
      </View>

      <View style={[st.panel, { paddingBottom: insets.bottom + space.lg }]}>
        <T v="heading" c={color.white}>
          {alert ? alert.title : 'Weather near home'}
        </T>
        <T v="small" c="rgba(255,255,255,0.8)" style={{ marginTop: 2, marginBottom: space.md }}>
          {alert ? alert.area : `${state.home.street || 'Your home'}. Pinch to zoom, drag to look around.`}
        </T>
        <RadarLegend light />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  top: { position: 'absolute', left: 0, right: 0, paddingHorizontal: space.lg, flexDirection: 'row', justifyContent: 'flex-end' },
  close: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: color.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: space.lg,
    backgroundColor: 'rgba(42,34,32,0.92)',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
  },
});
