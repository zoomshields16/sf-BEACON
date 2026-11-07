import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Sheet } from '@/components/sheet';
import { Button, Chips, Field, HazardBadge, s, T } from '@/components/ui';
import { Hazard, hazardById } from '@/lib/hazards';
import { floorsFor, suggestionsFor } from '@/lib/plan';
import { roomFor, useStore } from '@/lib/store';
import { color, radius, space } from '@/lib/theme';

const CUSTOM = '__custom__';

export default function EditSafeRoom() {
  const { hazard } = useLocalSearchParams<{ hazard: Hazard }>();
  const h = hazardById(hazard);
  const { state, dispatch } = useStore();
  const existing = roomFor(state, hazard);
  const spots = suggestionsFor(state.home, hazard);
  const isExit = hazard === 'wildfire';

  const matched = existing ? spots.find((sp) => sp.room === existing.room) : spots[0];
  const [pick, setPick] = useState<string>(existing && !matched ? CUSTOM : (matched?.room ?? CUSTOM));
  const [customRoom, setCustomRoom] = useState(existing && !matched ? existing.room : '');
  const [customFloor, setCustomFloor] = useState(existing && !matched ? existing.floor : '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [showNotes, setShowNotes] = useState(!!existing?.notes);

  const chosen =
    pick === CUSTOM ? { room: customRoom.trim(), floor: customFloor } : (spots.find((sp) => sp.room === pick) ?? { room: '', floor: '' });

  return (
    <Sheet
      title={`${h.name} ${isExit ? 'exit' : 'safe room'}`}
      canSave={!!chosen.room}
      onSave={() => dispatch({ type: 'saveRoom', room: { hazard, room: chosen.room, floor: chosen.floor, notes: notes.trim() } })}>
      <View style={st.intro}>
        <HazardBadge hazard={hazard} size={44} />
        <T v="small" c={color.inkSoft} style={{ flex: 1 }}>
          {h.guidance}
        </T>
      </View>

      {!state.home.profileDone ? (
        <Pressable onPress={() => router.push('/edit-home')} style={st.nudge} accessibilityRole="button">
          <Ionicons name="home-outline" size={18} color={color.ink} />
          <T v="small" style={{ flex: 1 }}>
            Answer a few questions about your home to get better suggestions.
          </T>
          <Ionicons name="chevron-forward" size={16} color={color.inkSoft} />
        </Pressable>
      ) : null}

      <T v="smallStrong" style={{ marginBottom: space.sm }}>
        {isExit ? 'Best ways out of your home' : 'Best spots in your home'}
      </T>
      <View style={[s.group, { marginBottom: space.lg }]}>
        {spots.map((sp) => (
          <Option key={sp.room} label={sp.room} detail={sp.floor} on={pick === sp.room} onPress={() => setPick(sp.room)} />
        ))}
        <Option label="Somewhere else" detail="Type your own" on={pick === CUSTOM} onPress={() => setPick(CUSTOM)} last />
      </View>

      {pick === CUSTOM ? (
        <View style={{ marginBottom: space.sm }}>
          <Field
            label={isExit ? 'Your exit' : 'Your spot'}
            value={customRoom}
            onChangeText={setCustomRoom}
            placeholder={isExit ? 'Side gate by the driveway' : 'Closet under the stairs'}
            autoFocus={!existing}
          />
          <T v="smallStrong" style={{ marginBottom: 6 }}>
            Where is it?
          </T>
          <Chips options={floorsFor(state.home)} value={customFloor} onChange={setCustomFloor} />
        </View>
      ) : null}

      {showNotes ? (
        <Field
          label="Directions for responders"
          value={notes}
          onChangeText={setNotes}
          placeholder="Door under the stairs, left of the kitchen. Flashlight on the shelf."
          multiline
          hint="Written so a firefighter who has never been inside could find you."
        />
      ) : (
        <Button kind="ghost" icon="add" label="Add directions for responders" onPress={() => setShowNotes(true)} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />
      )}

      {existing ? (
        <Button
          kind="ghost"
          label="Remove this safe room"
          onPress={() => {
            dispatch({ type: 'removeRoom', hazard });
            router.back();
          }}
          style={{ marginTop: space.lg }}
        />
      ) : null}
    </Sheet>
  );
}

function Option({ label, detail, on, onPress, last }: { label: string; detail: string; on: boolean; onPress: () => void; last?: boolean }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      style={({ pressed }) => [st.option, !last && st.divider, pressed && { backgroundColor: color.paper }]}>
      <View style={[st.radio, on && st.radioOn]}>{on ? <View style={st.radioDot} /> : null}</View>
      <View style={{ flex: 1 }}>
        <T v="bodyStrong">{label}</T>
        <T v="small" c={color.inkSoft}>
          {detail}
        </T>
      </View>
    </Pressable>
  );
}

const st = StyleSheet.create({
  intro: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start', marginBottom: space.xl },
  nudge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    backgroundColor: color.watchTint,
    marginBottom: space.lg,
  },
  option: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.lg, paddingVertical: 12 },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: color.line, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: color.red },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: color.red },
});
