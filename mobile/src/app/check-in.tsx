import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Pressable, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';

import { clock, plural } from '@/components/time';
import { T } from '@/components/ui';
import { hazardById } from '@/lib/hazards';
import { describeSpot } from '@/lib/plan';
import { activeAlerts, CheckInStatus, fullAddress, roomFor, useStore } from '@/lib/store';
import { color, radius, space } from '@/lib/theme';

const SECONDS = 30;
type Phase = 'ask' | 'safe' | 'saferoom' | 'help' | 'calling';

const buzz = (kind: 'warn' | 'tap' | 'ok') => {
  try {
    if (kind === 'warn') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    else if (kind === 'ok') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
  } catch {}
};

/** Full-bleed screen that pads itself clear of the Dynamic Island / notch and home indicator. */
function Full({ style, children }: { style: any; children: ReactNode }) {
  const insets = useSafeAreaInsets();
  const flat = Array.isArray(style) ? Object.assign({}, ...style) : style;
  const dark = flat?.backgroundColor === color.paper;
  return (
    <View style={[style, { paddingTop: Math.max(insets.top, 20) + space.sm, paddingBottom: insets.bottom }]}>
      <StatusBar style={dark ? 'dark' : 'light'} />
      {children}
    </View>
  );
}

function close() {
  if (router.canGoBack()) router.back();
  else router.replace('/today');
}

export default function CheckIn() {
  const { state, dispatch } = useStore();
  const alert = activeAlerts(state)[0];
  const [phase, setPhase] = useState<Phase>('ask');
  const [left, setLeft] = useState(SECONDS * 10); // tenths of a second

  // Countdown. When it runs out, we fall back to the automated voice call.
  useEffect(() => {
    if (phase !== 'ask' || !alert) return;
    buzz('warn');
    const id = setInterval(() => setLeft((t) => Math.max(0, t - 1)), 100);
    return () => clearInterval(id);
  }, [phase, alert?.id]);

  useEffect(() => {
    if (phase === 'ask' && left === 0 && alert) {
      dispatch({ type: 'checkIn', alertId: alert.id, status: 'no-response' });
      setPhase('calling');
      buzz('warn');
    }
  }, [left, phase]);

  if (!alert) {
    return (
      <Full style={[st.fill, { backgroundColor: color.paper, padding: space.xl, justifyContent: 'center' }]}>
        <T v="title">No active alert.</T>
        <T v="body" c={color.inkSoft} style={{ marginVertical: space.md }}>
          This alert has ended.
        </T>
        <Pressable onPress={close} style={[st.choice, { backgroundColor: color.ink }]}>
          <T v="heading" c={color.white}>
            Back to Today
          </T>
        </Pressable>
      </Full>
    );
  }

  const h = hazardById(alert.hazard);
  const room = roomFor(state, alert.hazard);

  const answer = (status: CheckInStatus, next: Phase) => {
    buzz(status === 'help' ? 'tap' : 'ok');
    dispatch({ type: 'checkIn', alertId: alert.id, status });
    setPhase(next);
  };

  if (phase === 'safe' || phase === 'saferoom') {
    return (
      <Full style={[st.fill, { backgroundColor: color.safe }]}>
        <View style={st.body}>
          <Ionicons name="checkmark-circle" size={56} color={color.white} />
          <T v="display" c={color.white} style={{ marginTop: space.lg }}>
            {phase === 'safe' ? "You're checked in as safe." : "You're checked in. Stay in your safe room."}
          </T>
          <T v="body" c="#D7F0E2" style={{ marginTop: space.md }}>
            We'll let you know when the {h.name.toLowerCase()} warning ends at {clock(alert.expiresAt)}. If anything
            changes, tap Change check-in on the Today screen.
          </T>
        </View>
        <View style={st.footer}>
          <Pressable onPress={close} style={[st.choice, { backgroundColor: color.white }]} accessibilityRole="button">
            <T v="heading" c={color.safe}>
              Done
            </T>
          </Pressable>
        </View>
      </Full>
    );
  }

  if (phase === 'help' || phase === 'calling') {
    return <Escalation phase={phase} onClose={close} onCancel={() => answer('safe', 'safe')} />;
  }

  // ---- Ask phase ----
  const progress = left / (SECONDS * 10);
  const secs = Math.ceil(left / 10);
  const R = 34;
  const C = 2 * Math.PI * R;

  return (
    <Full style={[st.fill, { backgroundColor: color.redDeep }]}>
      <View style={st.body}>
        <View style={st.topRow}>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <MaterialCommunityIcons name={h.icon} size={20} color={color.white} />
              <T v="bodyStrong" c={color.white}>
                {alert.title}
              </T>
            </View>
            <T v="small" c="#F4BDB5" style={{ marginTop: 2 }}>
              {alert.area}. Until {clock(alert.expiresAt)}.
            </T>
          </View>
          <View
            style={st.ring}
            accessible
            accessibilityLabel={`${secs} seconds left to check in`}>
            <Svg width={80} height={80}>
              <Circle cx={40} cy={40} r={R} stroke="rgba(255,255,255,0.18)" strokeWidth={6} fill="none" />
              <Circle
                cx={40}
                cy={40}
                r={R}
                stroke={color.white}
                strokeWidth={6}
                fill="none"
                strokeLinecap="round"
                strokeDasharray={`${C} ${C}`}
                strokeDashoffset={C * (1 - progress)}
                transform="rotate(-90 40 40)"
              />
            </Svg>
            <View style={StyleSheet.absoluteFill}>
              <View style={st.ringLabel}>
                <T v="title" c={color.white}>
                  {secs}
                </T>
              </View>
            </View>
          </View>
        </View>

        <T v="caption" c="#F4BDB5" style={{ marginTop: space.xxl }}>
          Your {h.name.toLowerCase()} safe room
        </T>
        <T v="display" c={color.white} style={st.where}>
          {room ? room.room : 'Lowest floor, interior room, away from windows.'}
        </T>
        {room && (describeSpot(room.room, room.floor) !== room.room || room.notes) ? (
          <T v="body" c="#FFE3DF" style={{ marginTop: space.sm }}>
            {[describeSpot(room.room, room.floor) !== room.room ? room.floor : '', room.notes].filter(Boolean).join('. ')}
          </T>
        ) : null}
      </View>

      <View style={st.footer}>
        <T v="smallStrong" c="#F4BDB5" style={{ marginBottom: space.sm }}>
          Check in so we know you're OK. If you don't answer, we'll call you.
        </T>
        <Choice label="I'm safe" icon="checkmark-circle-outline" onPress={() => answer('safe', 'safe')} />
        <Choice label="I'm in my safe room" icon="home-outline" onPress={() => answer('saferoom', 'saferoom')} />
        <Choice label="I need help" icon="alert-circle" danger onPress={() => answer('help', 'help')} />
      </View>
    </Full>
  );
}

function Choice({ label, icon, onPress, danger }: { label: string; icon: any; onPress: () => void; danger?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        st.choice,
        danger ? { backgroundColor: color.red, borderWidth: 2, borderColor: color.white } : { backgroundColor: color.white },
        pressed && { transform: [{ scale: 0.98 }] },
      ]}>
      <Ionicons name={icon} size={24} color={danger ? color.white : color.redDeep} />
      <T v="heading" c={danger ? color.white : color.redDeep}>
        {label}
      </T>
    </Pressable>
  );
}

/** What we send, shown so the person knows exactly what responders will see. */
function Escalation({ phase, onClose, onCancel }: { phase: 'help' | 'calling'; onClose: () => void; onCancel: () => void }) {
  const { state } = useStore();
  const alert = activeAlerts(state)[0];
  const room = alert ? roomFor(state, alert.hazard) : undefined;
  const hh = state.household;

  const items = [
    { icon: 'location-outline', label: 'Address', value: fullAddress(state.home) },
    { icon: 'home-outline', label: 'Safe room', value: room ? describeSpot(room.room, room.floor) : 'Not set' },
    {
      icon: 'people-outline',
      label: 'Household',
      value: `${plural(hh.adults, 'adult', 'adults')}, ${plural(hh.children, 'child', 'children')}, ${plural(hh.pets, 'pet', 'pets')}${hh.needs ? `. ${hh.needs}` : ''}`,
    },
    { icon: 'key-outline', label: 'Getting inside', value: state.home.accessNotes || 'No access notes' },
    { icon: 'battery-half-outline', label: 'Phone', value: 'Battery 62%, last seen at home' },
  ] as const;

  // One orchestrated reveal: rows tick in as they "send".
  const anims = useRef(items.map(() => new Animated.Value(0))).current;
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce) return anims.forEach((a) => a.setValue(1));
      Animated.stagger(
        350,
        anims.map((a) => Animated.timing(a, { toValue: 1, duration: 250, useNativeDriver: true })),
      ).start();
    });
  }, []);

  const calling = phase === 'calling';

  return (
    <Full style={[st.fill, { backgroundColor: color.redDeep }]}>
      <View style={st.body}>
        <View style={st.callBadge}>
          <Ionicons name={calling ? 'call' : 'radio-outline'} size={26} color={color.redDeep} />
        </View>
        <T v="display" c={color.white} style={{ marginTop: space.lg }}>
          {calling ? "We're calling you now." : 'Sending your details to 911.'}
        </T>
        <T v="body" c="#FFE3DF" style={{ marginTop: space.sm }}>
          {calling
            ? "We didn't hear from you. Answer to talk to our voice assistant. If you can't talk, stay on the line and we'll send help to your safe room."
            : 'Stay where you are if it is safe. Keep your phone with you and the volume up.'}
        </T>

        <View style={st.packet}>
          {items.map((it, i) => (
            <Animated.View
              key={it.label}
              style={[
                st.packetRow,
                i < items.length - 1 && st.packetDivider,
                { opacity: anims[i], transform: [{ translateY: anims[i].interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] },
              ]}>
              <Ionicons name={it.icon} size={18} color="#F4BDB5" />
              <View style={{ flex: 1 }}>
                <T v="caption" c="#F4BDB5">
                  {it.label}
                </T>
                <T v="smallStrong" c={color.white}>
                  {it.value}
                </T>
              </View>
              <Ionicons name="checkmark" size={18} color={color.white} />
            </Animated.View>
          ))}
        </View>
      </View>

      <View style={st.footer}>
        {calling ? (
          <Pressable onPress={onCancel} style={[st.choice, { backgroundColor: color.white }]} accessibilityRole="button">
            <T v="heading" c={color.redDeep}>
              I'm OK, cancel the call
            </T>
          </Pressable>
        ) : null}
        <Pressable onPress={onClose} style={[st.choice, st.outline]} accessibilityRole="button">
          <T v="heading" c={color.white}>
            Close
          </T>
        </Pressable>
      </View>
    </Full>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1 },
  body: { flex: 1, paddingHorizontal: space.xl, paddingTop: space.lg },
  topRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.lg },
  ring: { width: 80, height: 80 },
  ringLabel: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  where: { fontSize: 44, lineHeight: 48, marginTop: space.xs },
  footer: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.sm },
  choice: {
    minHeight: 64,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
  },
  outline: { borderWidth: 2, borderColor: 'rgba(255,255,255,0.5)' },
  callBadge: { width: 56, height: 56, borderRadius: 28, backgroundColor: color.white, alignItems: 'center', justifyContent: 'center' },
  packet: { marginTop: space.xl, borderRadius: radius.lg, backgroundColor: 'rgba(0,0,0,0.18)' },
  packetRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, paddingHorizontal: space.lg },
  packetDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.15)' },
});
