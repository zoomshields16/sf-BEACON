import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { clock, day, STATUS_PHRASE } from '@/components/time';
import { HazardBadge, Screen, Section, T } from '@/components/ui';
import { activeAlerts, Alert, pastAlerts, useStore } from '@/lib/store';
import { color, radius, space } from '@/lib/theme';

export default function Alerts() {
  const { state } = useStore();
  const live = activeAlerts(state);
  const past = pastAlerts(state);

  return (
    <Screen title="Alerts" subtitle={`Official alerts for ${state.home.county || 'your home'}.`}>
      {live.length ? (
        <Section title="Happening now">
          {live.map((a, i) => (
            <AlertRow key={a.id} a={a} live last={i === live.length - 1} />
          ))}
        </Section>
      ) : (
        <View style={st.empty}>
          <T v="bodyStrong">Nothing active right now.</T>
          <T v="small" c={color.inkSoft}>
            When the National Weather Service or USGS issues an alert for your area, it shows up here and on your lock
            screen.
          </T>
        </View>
      )}

      {past.length ? (
        <Section title="Earlier">
          {past.map((a, i) => (
            <AlertRow key={a.id} a={a} last={i === past.length - 1} />
          ))}
        </Section>
      ) : null}
    </Screen>
  );
}

function AlertRow({ a, live, last }: { a: Alert; live?: boolean; last?: boolean }) {
  const detail = live
    ? `${a.area}. Until ${clock(a.expiresAt)}.`
    : `${a.area}. ${day(a.issuedAt)}${a.checkIn ? `. You checked in ${STATUS_PHRASE[a.checkIn.status]}.` : '.'}`;
  return (
    <Pressable
      onPress={live ? () => router.push('/check-in') : undefined}
      disabled={!live}
      style={({ pressed }) => [st.row, !last && st.divider, pressed && { backgroundColor: color.paper }]}>
      <HazardBadge hazard={a.hazard} muted={!live} />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
          <T v="bodyStrong">{a.title}</T>
          {a.level === 'warning' && live ? (
            <View style={st.tag}>
              <T v="caption" c={color.white}>
                Warning
              </T>
            </View>
          ) : null}
        </View>
        <T v="small" c={color.inkSoft}>
          {detail}
        </T>
        <T v="caption" c={color.inkSoft} style={{ marginTop: 2 }}>
          {a.source}
        </T>
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  empty: { marginTop: space.xl, padding: space.lg, borderRadius: radius.lg, backgroundColor: color.white, gap: space.xs },
  row: { flexDirection: 'row', gap: space.md, padding: space.lg, alignItems: 'flex-start' },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  tag: { backgroundColor: color.red, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
});
