import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Button, Row, Screen, Section, T, ToggleRow } from '@/components/ui';
import { makeTestAlert, useStore } from '@/lib/store';
import { color, radius, space } from '@/lib/theme';

export default function Profile() {
  const { state, dispatch } = useStore();
  const { user, policy, settings, contacts } = state;
  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <Screen title="Profile">
      <View style={st.me}>
        <View style={st.avatar}>
          <T v="heading" c={color.white}>
            {initials || '?'}
          </T>
        </View>
        <View style={{ flex: 1 }}>
          <T v="heading">{user.name || 'Add your name'}</T>
          <T v="small" c={color.inkSoft}>
            {user.phone || 'No phone number'}
          </T>
          <T v="small" c={color.inkSoft}>
            {user.email}
          </T>
        </View>
        <Button kind="ghost" label="Edit" onPress={() => router.push('/edit-profile')} />
      </View>

      <Section title="State Farm policy">
        {policy.linked ? (
          <>
            <Row icon="document-text-outline" label={`${policy.type} policy`} value={policy.number} />
            <Row icon="unlink-outline" label="Disconnect policy" tone="danger" onPress={() => dispatch({ type: 'unlinkPolicy' })} last />
          </>
        ) : (
          <View style={{ padding: space.lg, gap: space.md }}>
            <T v="small" c={color.inkSoft}>
              Connect your policy to fill in your home details and let State Farm send help faster after a disaster.
            </T>
            <Button label="Connect with State Farm" icon="link-outline" onPress={() => dispatch({ type: 'linkPolicy' })} />
          </View>
        )}
      </Section>

      <Section title="Emergency contacts" action={{ label: 'Add', onPress: () => router.push({ pathname: '/contact/[id]', params: { id: 'new' } }) }}>
        {contacts.length ? (
          contacts.map((c, i) => (
            <Row
              key={c.id}
              icon="call-outline"
              label={c.relation || 'Contact'}
              value={`${c.name}, ${c.phone}`}
              onPress={() => router.push({ pathname: '/contact/[id]', params: { id: c.id } })}
              last={i === contacts.length - 1}
            />
          ))
        ) : (
          <Row
            icon="person-add-outline"
            label="Who should we text if we can't reach you?"
            placeholder="Add a contact"
            onPress={() => router.push({ pathname: '/contact/[id]', params: { id: 'new' } })}
            last
          />
        )}
      </Section>

      <Section title="During an emergency">
        <ToggleRow
          label="Critical alerts"
          detail="Sound alerts even when your phone is on silent."
          value={settings.criticalAlerts}
          onChange={(v) => dispatch({ type: 'settings', patch: { criticalAlerts: v } })}
        />
        <ToggleRow
          label="Call me if I don't check in"
          detail="An automated voice call after 30 seconds without a response."
          value={settings.voiceCallBackup}
          onChange={(v) => dispatch({ type: 'settings', patch: { voiceCallBackup: v } })}
        />
        <ToggleRow
          label="Share my home details with 911"
          detail="Address, safe room and household, only when you ask for help."
          value={settings.shareWithResponders}
          onChange={(v) => dispatch({ type: 'settings', patch: { shareWithResponders: v } })}
          last
        />
      </Section>

      <Section title="Demo">
        <Row
          icon="flash-outline"
          label="Run a test tornado warning"
          onPress={() => {
            dispatch({ type: 'triggerAlert', alert: makeTestAlert() });
            router.push('/check-in');
          }}
        />
        <Row
          icon="refresh-outline"
          label="Reset app and start over"
          tone="danger"
          onPress={() => {
            dispatch({ type: 'reset' });
            router.replace('/onboarding');
          }}
          last
        />
      </Section>
    </Screen>
  );
}

const st = StyleSheet.create({
  me: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginTop: space.lg,
    padding: space.lg,
    backgroundColor: color.white,
    borderRadius: radius.lg,
  },
  avatar: { width: 52, height: 52, borderRadius: 26, backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center' },
});
