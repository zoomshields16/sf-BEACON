import { router } from 'expo-router';
import { View } from 'react-native';

import { Row, Screen, Section, T } from '@/components/ui';
import { HAZARDS } from '@/lib/hazards';
import { describeSpot } from '@/lib/plan';
import { roomFor, useStore } from '@/lib/store';
import { color, space } from '@/lib/theme';

export default function MyHome() {
  const { state } = useStore();
  const { home, household } = state;

  const people = [
    household.adults && `${household.adults} adult${household.adults > 1 ? 's' : ''}`,
    household.children && `${household.children} child${household.children > 1 ? 'ren' : ''}`,
    household.pets && `${household.pets} pet${household.pets > 1 ? 's' : ''}`,
  ]
    .filter(Boolean)
    .join(', ');

  const layout = [
    `${home.floors} ${home.floors === 1 ? 'floor' : 'floors'}`,
    home.hasBasement && 'basement',
    home.hasStormShelter && 'storm shelter',
    home.hasAtticAccess && 'attic with exit',
    home.hasGarage && 'garage',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <Screen title="My Home" subtitle="What responders will know about your home.">
      <Section title="Address" action={{ label: 'Edit', onPress: () => router.push('/edit-home') }}>
        <View style={{ padding: space.lg }}>
          {home.street ? (
            <>
              <T v="heading">{home.street}</T>
              <T v="body" c={color.inkSoft}>
                {home.city}, {home.state} {home.zip}
              </T>
              <T v="small" c={color.inkSoft} style={{ marginTop: space.sm }}>
                {home.homeType}
                {state.policy.linked ? '. Synced from your State Farm policy.' : '.'}
              </T>
            </>
          ) : (
            <T v="bodyStrong" c={color.red} style={{}} >
              Add your home address
            </T>
          )}
        </View>
      </Section>

      <Section title="Home details" action={{ label: 'Edit', onPress: () => router.push('/edit-home') }}>
        <Row
          icon="business-outline"
          label="Layout"
          value={home.profileDone ? layout : undefined}
          placeholder={home.profileDone ? undefined : 'Answer a few questions'}
          onPress={() => router.push('/edit-home')}
        />
        <Row
          icon="cube-outline"
          label="Rooms without windows"
          value={home.interiorRooms.length ? home.interiorRooms.join(', ') : 'None added'}
          onPress={() => router.push('/edit-home')}
          last
        />
      </Section>

      <Section title="Where to go">
        {HAZARDS.map((h, i) => {
          const r = roomFor(state, h.id);
          return (
            <Row
              key={h.id}
              hazard={h.id}
              label={h.name}
              value={r ? describeSpot(r.room, r.floor) : undefined}
              placeholder={r ? undefined : 'Add a safe room'}
              onPress={() => router.push({ pathname: '/safe-room/[hazard]', params: { hazard: h.id } })}
              last={i === HAZARDS.length - 1}
            />
          );
        })}
      </Section>

      <Section title="Who lives here" action={{ label: 'Edit', onPress: () => router.push('/edit-household') }}>
        <Row icon="people-outline" label="Household" value={people || 'No one added'} onPress={() => router.push('/edit-household')} />
        <Row
          icon="medkit-outline"
          label="Medical or mobility needs"
          value={household.needs || undefined}
          placeholder={household.needs ? undefined : 'Add needs'}
          onPress={() => router.push('/edit-household')}
          last
        />
      </Section>

      <Section title="Getting inside" action={{ label: 'Edit', onPress: () => router.push('/edit-home') }}>
        <Row
          icon="key-outline"
          label="Access notes for responders"
          value={home.accessNotes || undefined}
          placeholder={home.accessNotes ? undefined : 'Add gate code, spare key, shutoffs'}
          onPress={() => router.push('/edit-home')}
          last
        />
      </Section>

      <T v="caption" c={color.inkSoft} style={{ marginTop: space.lg, paddingHorizontal: 2 }}>
        Shared only with 911 dispatch and State Farm catastrophe teams, and only during an active emergency at this address.
      </T>
    </Screen>
  );
}
