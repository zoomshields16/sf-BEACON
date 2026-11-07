import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { clock, STATUS_PHRASE } from '@/components/time';
import { RadarCard } from '@/components/radar-card';
import { Button, Row, Screen, Section, T } from '@/components/ui';
import { hazardById } from '@/lib/hazards';
import { activeAlerts, makeTestAlert, readiness, roomFor, useStore } from '@/lib/store';
import { color, radius, space } from '@/lib/theme';

export default function Today() {
  const { state, dispatch } = useStore();
  const alert = activeAlerts(state)[0];
  const ready = readiness(state);
  const firstName = state.user.name.split(' ')[0];

  const runTest = () => {
    dispatch({ type: 'triggerAlert', alert: makeTestAlert() });
    router.push('/check-in');
  };

  return (
    <Screen>
      {/* Brand bar */}
      <View style={st.brand}>
        <View style={st.mark}>
          <MaterialCommunityIcons name="lighthouse-on" size={17} color={color.white} />
        </View>
        <T v="heading" style={{ flex: 1, letterSpacing: 1.5 }}>
          BEACON
        </T>
        <Pressable onPress={runTest} style={st.testPill} accessibilityRole="button" hitSlop={6}>
          <Ionicons name="flash-outline" size={14} color={color.ink} />
          <T v="caption">Test alert</T>
        </Pressable>
      </View>

      {/* Status */}
      {!alert ? (
        <View style={st.clear}>
          <View style={st.statusLine}>
            <View style={[st.dot, { backgroundColor: color.safe }]} />
            <T v="smallStrong" c={color.safe}>
              No alerts for {state.home.county || 'your area'}
            </T>
          </View>
          <T v="display" style={{ marginTop: space.md }}>
            {firstName ? `All clear at home, ${firstName}.` : 'All clear at home.'}
          </T>
          <T v="body" c={color.inkSoft} style={{ marginTop: space.sm }}>
            We watch the National Weather Service and USGS for {state.home.street || 'your home'} and will alert you the
            moment something changes.
          </T>
        </View>
      ) : !alert.checkIn ? (
        <ActiveAlert alertId={alert.id} />
      ) : (
        <CheckedIn alertId={alert.id} />
      )}

      {/* Readiness */}
      {ready.done < ready.total ? (
        <Section title="Finish your plan">
          <View style={st.progressWrap}>
            <T v="small" c={color.inkSoft}>
              {ready.done} of {ready.total} done. Responders see everything you add here.
            </T>
            <View style={st.track}>
              <View style={[st.fill, { width: `${(ready.done / ready.total) * 100}%` }]} />
            </View>
          </View>
          {ready.items
            .filter((i) => !i.done)
            .map((i, idx, arr) => (
              <Row
                key={i.label}
                icon="ellipse-outline"
                label={i.label}
                onPress={() => router.push(i.label.includes('contact') ? '/profile' : i.label.includes('Home details') ? '/edit-home' : '/home')}
                last={idx === arr.length - 1}
              />
            ))}
        </Section>
      ) : null}

      <RadarCard />
    </Screen>
  );
}

function ActiveAlert({ alertId }: { alertId: string }) {
  const { state } = useStore();
  const a = state.alerts.find((x) => x.id === alertId)!;
  const h = hazardById(a.hazard);
  const room = roomFor(state, a.hazard);
  return (
    <View style={st.alert}>
      <View style={st.statusLine}>
        <MaterialCommunityIcons name={h.icon} size={18} color={color.white} />
        <T v="smallStrong" c={color.white}>
          {a.title} until {clock(a.expiresAt)}
        </T>
      </View>
      <T v="display" c={color.white} style={{ marginTop: space.md }}>
        {room ? `Go to your ${room.room.toLowerCase()} now.` : 'Take shelter now.'}
      </T>
      <T v="body" c="#FFD9D4" style={{ marginTop: space.sm, marginBottom: space.lg }}>
        {a.instructions}
      </T>
      <Button kind="inverse" big label="Check in" onPress={() => router.push('/check-in')} />
    </View>
  );
}

function CheckedIn({ alertId }: { alertId: string }) {
  const { state, dispatch } = useStore();
  const a = state.alerts.find((x) => x.id === alertId)!;
  const status = a.checkIn!.status;
  const needsHelp = status === 'help' || status === 'no-response';
  const n = a.neighborhood;
  return (
    <View style={[st.checked, needsHelp && { backgroundColor: color.redTint }]}>
      <View style={st.statusLine}>
        <View style={[st.dot, { backgroundColor: needsHelp ? color.red : color.safe }]} />
        <T v="smallStrong" c={needsHelp ? color.red : color.safe}>
          {a.title} until {clock(a.expiresAt)}
        </T>
      </View>
      <T v="title" style={{ marginTop: space.md }}>
        {status === 'help' ? 'Help has been requested.' : status === 'no-response' ? "We couldn't reach you." : `You checked in ${STATUS_PHRASE[status]}.`}
      </T>
      <T v="body" c={color.inkSoft} style={{ marginTop: space.xs }}>
        {needsHelp
          ? 'Your address, safe room and household details were sent to 911 dispatch. Stay where you are if it is safe, and tap Change check-in if you are OK.'
          : `Checked in at ${clock(a.checkIn!.at)}. Stay sheltered until the warning ends.`}
      </T>
      {n ? (
        <View style={st.neighbors}>
          <Ionicons name="people-outline" size={18} color={color.ink} />
          <T v="small" style={{ flex: 1 }}>
            {n.checkedIn} of {n.total} neighbors near you have checked in. {n.reportingDamage} report damage.
          </T>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: space.sm, marginTop: space.lg }}>
        <Button kind="secondary" label="Change check-in" onPress={() => router.push('/check-in')} style={{ flex: 1 }} />
        <Button kind="ghost" label="End test" onPress={() => dispatch({ type: 'endAlert', alertId })} />
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingTop: space.sm, paddingBottom: space.lg },
  mark: { width: 28, height: 28, borderRadius: 7, backgroundColor: color.red, alignItems: 'center', justifyContent: 'center' },
  testPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.white,
  },
  clear: { paddingTop: space.sm, paddingBottom: space.sm },
  statusLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  dot: { width: 10, height: 10, borderRadius: 5 },
  alert: { backgroundColor: color.red, borderRadius: radius.lg, padding: space.xl },
  checked: { backgroundColor: color.safeTint, borderRadius: radius.lg, padding: space.xl },
  neighbors: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    marginTop: space.lg,
    paddingTop: space.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(42,34,32,0.2)',
  },
  progressWrap: { padding: space.lg, gap: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  track: { height: 6, borderRadius: 3, backgroundColor: color.paper, overflow: 'hidden' },
  fill: { height: 6, backgroundColor: color.red, borderRadius: 3 },
});
