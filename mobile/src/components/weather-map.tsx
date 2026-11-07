import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Circle, Marker, UrlTile } from 'react-native-maps';

import { color } from '@/lib/theme';

// NOAA NEXRAD base reflectivity composite (US), served as map tiles by the Iowa Environmental Mesonet.
// Refreshes every 5 minutes on their side; we bust the cache on the same cadence.
const RADAR = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913/{z}/{x}/{y}.png';
export const RADAR_REFRESH_MS = 5 * 60 * 1000;

export type WeatherMapProps = {
  lat: number;
  lng: number;
  /** Draw the warning area around home. */
  warning?: boolean;
  interactive?: boolean;
  zoom?: 'near' | 'region';
};

export function WeatherMap({ lat, lng, warning, interactive, zoom = 'near' }: WeatherMapProps) {
  const [tick, setTick] = useState(() => Math.floor(Date.now() / RADAR_REFRESH_MS));

  useEffect(() => {
    const id = setInterval(() => setTick(Math.floor(Date.now() / RADAR_REFRESH_MS)), 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const delta = zoom === 'near' ? 1.1 : 4;

  return (
    <MapView
      style={StyleSheet.absoluteFill}
      initialRegion={{ latitude: lat, longitude: lng, latitudeDelta: delta, longitudeDelta: delta }}
      mapType="mutedStandard"
      scrollEnabled={!!interactive}
      zoomEnabled={!!interactive}
      pitchEnabled={false}
      rotateEnabled={false}
      showsPointsOfInterests={false}
      toolbarEnabled={false}>
      <UrlTile key={tick} urlTemplate={`${RADAR}?t=${tick}`} maximumZ={12} opacity={0.75} zIndex={1} shouldReplaceMapContent={false} />
      {warning ? (
        <Circle
          center={{ latitude: lat, longitude: lng }}
          radius={14000}
          strokeColor={color.red}
          strokeWidth={2}
          fillColor="rgba(214,35,17,0.12)"
          zIndex={2}
        />
      ) : null}
      <Marker coordinate={{ latitude: lat, longitude: lng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
        <View style={st.pinRing}>
          <View style={st.pin} />
        </View>
      </Marker>
    </MapView>
  );
}

const st = StyleSheet.create({
  pinRing: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: color.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  pin: { width: 12, height: 12, borderRadius: 6, backgroundColor: color.red },
});
