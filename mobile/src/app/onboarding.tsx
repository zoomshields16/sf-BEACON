import Ionicons from '@expo/vector-icons/Ionicons';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { HomeStructureForm, InteriorRoomsPicker } from '@/components/home-form';
import { Button, Field, Row, s as ui, T } from '@/components/ui';
import { toE164 } from '@/lib/api';
import { geocodeHome } from '@/lib/geocode';
import { HAZARDS } from '@/lib/hazards';
import { describeSpot } from '@/lib/plan';
import { MOCK_POLICY_PULL, roomFor, useStore } from '@/lib/store';
import { color, radius, space } from '@/lib/theme';

const STEPS = ['welcome', 'account', 'policy', 'address', 'structure', 'rooms', 'plan'] as const;
type Step = (typeof STEPS)[number];

export default function Onboarding() {
  const { state, dispatch } = useStore();
  const [step, setStep] = useState<Step>('welcome');
  const [user, setUser] = useState(state.user);
  const [home, setHome] = useState(state.home);
  const [linked, setLinked] = useState(state.policy.linked);

  const idx = STEPS.indexOf(step);
  const next = () => {
    const to = STEPS[idx + 1];
    if (step === 'address') geocodeHome(home).then((c) => c && setHome((h) => ({ ...h, ...c })));
    if (to === 'plan') {
      // Save what we have so the plan screen (and the safe room editor) can use it, then build fresh suggestions.
      dispatch({ type: 'user', patch: user });
      dispatch({ type: 'home', patch: { ...home, profileDone: true } });
      if (linked) dispatch({ type: 'patch', patch: { policy: MOCK_POLICY_PULL.policy } });
      dispatch({ type: 'patch', patch: { safeRooms: [] } });
      dispatch({ type: 'suggestRooms' });
    }
    setStep(to);
  };
  const back = () => setStep(STEPS[idx - 1]);

  const finish = () => {
    if (home.lat != null) dispatch({ type: 'home', patch: { lat: home.lat, lng: home.lng } });
    dispatch({ type: 'patch', patch: { onboarded: true } });
    router.replace('/today');
  };

  if (step === 'welcome') {
    return (
      <SafeAreaView style={[st.fill, { backgroundColor: color.red }]}>
        <View style={st.welcome}>
          <View style={st.mark}>
            <MaterialCommunityIcons name="lighthouse-on" size={26} color={color.red} />
          </View>
          <T v="title" c={color.white} style={{ marginTop: space.lg, letterSpacing: 3 }}>
            BEACON
          </T>
          <T v="caption" c="#FFD9D4" style={{ marginTop: 2 }}>
            State Farm Basic Emergency Assistance & Cognitive Outreach Network
          </T>
          <T v="display" c={color.white} style={{ fontSize: 44, lineHeight: 48, marginTop: space.xl }}>
            Know where to go before the storm does.
          </T>
          <T v="body" c="#FFE3DF" style={{ marginTop: space.lg }}>
            Set up a safe room for each kind of disaster. When an alert hits your address, we tell you where to go,
            check that you're OK, and send help if you're not.
          </T>
        </View>
        <View style={{ padding: space.lg, gap: space.sm }}>
          <Button kind="inverse" big label="Get started" onPress={next} />
          <Button kind="ghostLight" label="I already have an account" onPress={next} />
        </View>
      </SafeAreaView>
    );
  }

  const canContinue =
    step === 'account'
      ? !!user.name.trim() && !!toE164(user.phone)
      : step === 'address'
        ? !!home.street.trim() && !!home.zip.trim()
        : true;

  return (
    <SafeAreaView style={[st.fill, { backgroundColor: color.paper }]}>
      <KeyboardAvoidingView style={st.fill} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {/* Progress: this is a real sequence, so steps are shown */}
        <View style={st.top}>
          <Pressable onPress={back} hitSlop={12} accessibilityLabel="Back" accessibilityRole="button">
            <Ionicons name="chevron-back" size={26} color={color.ink} />
          </Pressable>
          <View style={st.bars}>
            {STEPS.slice(1).map((s, i) => (
              <View key={s} style={[st.bar, i < idx && { backgroundColor: color.red }]} />
            ))}
          </View>
          <T v="caption" c={color.inkSoft} style={{ width: 40, textAlign: 'right' }}>
            {idx} of {STEPS.length - 1}
          </T>
        </View>

        <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {step === 'account' && (
            <>
              <Heading title="Who are you?" body="We use your phone number to reach you during an emergency." />
              <Field label="Full name" value={user.name} onChangeText={(v) => setUser({ ...user, name: v })} placeholder="Alex Morgan" autoCapitalize="words" />
              <Field label="Mobile number" value={user.phone} onChangeText={(v) => setUser({ ...user, phone: v })} placeholder="(214) 555-0199" keyboardType="phone-pad" />
              <Field label="Email" value={user.email} onChangeText={(v) => setUser({ ...user, email: v })} placeholder="alex@example.com" keyboardType="email-address" autoCapitalize="none" />
            </>
          )}

          {step === 'policy' && (
            <>
              <Heading
                title="Connect your State Farm policy"
                body="We'll pull your home address from your policy, and State Farm can send help and an adjuster faster after a disaster."
              />
              {linked ? (
                <View style={st.linked}>
                  <Ionicons name="checkmark-circle" size={28} color={color.safe} />
                  <View style={{ flex: 1 }}>
                    <T v="bodyStrong">Homeowners policy connected</T>
                    <T v="small" c={color.inkSoft}>
                      {MOCK_POLICY_PULL.policy.number}. {MOCK_POLICY_PULL.home.street}, {MOCK_POLICY_PULL.home.city}
                    </T>
                  </View>
                </View>
              ) : (
                <View style={{ gap: space.sm }}>
                  <Button
                    label="Connect with State Farm"
                    icon="link-outline"
                    big
                    onPress={() => {
                      setLinked(true);
                      if (!home.street) setHome({ ...home, ...MOCK_POLICY_PULL.home });
                    }}
                  />
                  <T v="caption" c={color.inkSoft} style={{ textAlign: 'center' }}>
                    Opens the State Farm app to sign in. We only read your policy and property address.
                  </T>
                </View>
              )}
            </>
          )}

          {step === 'address' && (
            <>
              <Heading
                title="Where is home?"
                body={linked ? 'Filled in from your policy. Check that it is right.' : 'Alerts are matched to this address, so we never track your location.'}
              />
              <Field label="Street address" value={home.street} onChangeText={(v) => setHome({ ...home, street: v, lat: undefined, lng: undefined })} placeholder="2401 Elm Street" />
              <View style={{ flexDirection: 'row', gap: space.md }}>
                <View style={{ flex: 2 }}>
                  <Field label="City" value={home.city} onChangeText={(v) => setHome({ ...home, city: v })} placeholder="Richardson" />
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="State" value={home.state} onChangeText={(v) => setHome({ ...home, state: v })} placeholder="TX" maxLength={2} autoCapitalize="characters" />
                </View>
              </View>
              <Field
                label="ZIP"
                value={home.zip}
                onChangeText={(v) => setHome({ ...home, zip: v, county: home.county || (v.length === 5 ? 'Dallas County' : ''), lat: undefined, lng: undefined })}
                placeholder="75080"
                keyboardType="number-pad"
                maxLength={5}
              />
            </>
          )}

          {step === 'structure' && (
            <>
              <Heading title="Tell us about your home" body="We use this to suggest where to go for each kind of disaster, so you aren't guessing later." />
              <HomeStructureForm value={home} onChange={(p) => setHome((h) => ({ ...h, ...p }))} />
            </>
          )}

          {step === 'rooms' && (
            <>
              <Heading
                title="Which ground floor rooms have no windows?"
                body="These are the safest places in a tornado or hurricane. Pick any that apply or type your own."
              />
              <InteriorRoomsPicker value={home.interiorRooms} onChange={(rooms) => setHome((h) => ({ ...h, interiorRooms: rooms }))} />
            </>
          )}

          {step === 'plan' && (
            <>
              <Heading title="Here's your plan" body="We picked the best spot in your home for each disaster. Tap any one to change it." />
              <View style={ui.group}>
                {HAZARDS.map((h, i) => {
                  const r = roomFor(state, h.id);
                  return (
                    <Row
                      key={h.id}
                      hazard={h.id}
                      label={h.name}
                      value={r ? describeSpot(r.room, r.floor) : undefined}
                      placeholder={r ? undefined : 'Pick a spot'}
                      onPress={() => router.push({ pathname: '/safe-room/[hazard]', params: { hazard: h.id } })}
                      last={i === HAZARDS.length - 1}
                    />
                  );
                })}
              </View>
              <T v="caption" c={color.inkSoft} style={{ marginTop: space.md }}>
                You can change any of this later in My Home.
              </T>
            </>
          )}
        </ScrollView>

        <View style={{ padding: space.lg, gap: space.sm }}>
          <Button
            label={step === 'plan' ? 'Finish setup' : 'Continue'}
            onPress={step === 'plan' ? finish : next}
            disabled={!canContinue}
            big
          />
          {step === 'policy' && !linked ? <Button kind="ghost" label="Skip for now" onPress={next} /> : null}
          {step === 'rooms' && home.interiorRooms.length === 0 ? <Button kind="ghost" label="None of these" onPress={next} /> : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function Heading({ title, body }: { title: string; body: string }) {
  return (
    <View style={{ marginTop: space.md, marginBottom: space.xl }}>
      <T v="title" style={{ fontSize: 28, lineHeight: 34 }}>
        {title}
      </T>
      <T v="body" c={color.inkSoft} style={{ marginTop: space.sm }}>
        {body}
      </T>
    </View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1 },
  welcome: { flex: 1, justifyContent: 'flex-end', paddingHorizontal: space.xl, paddingBottom: space.xxl },
  mark: { width: 44, height: 44, borderRadius: 12, backgroundColor: color.white, alignItems: 'center', justifyContent: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingTop: space.sm },
  bars: { flex: 1, flexDirection: 'row', gap: 6 },
  bar: { flex: 1, height: 4, borderRadius: 2, backgroundColor: color.line },
  linked: {
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'center',
    padding: space.lg,
    backgroundColor: color.white,
    borderRadius: radius.lg,
  },
});
