import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { s, Stepper, T, ToggleRow } from '@/components/ui';
import { HomeProfile, INTERIOR_ROOM_OPTIONS } from '@/lib/plan';
import { color, font, radius, space } from '@/lib/theme';

/** The structure questions: floors and what the house has. */
export function HomeStructureForm({ value, onChange }: { value: HomeProfile; onChange: (p: HomeProfile) => void }) {
  const set = (patch: Partial<HomeProfile>) => onChange({ ...value, ...patch });
  return (
    <View style={s.group}>
      <Stepper label="Floors above ground" value={value.floors} onChange={(n) => set({ floors: Math.max(1, Math.min(4, n)) })} />
      <ToggleRow label="Basement" value={value.hasBasement} onChange={(v) => set({ hasBasement: v })} />
      <ToggleRow label="Storm shelter" detail="Underground or reinforced, inside or in the yard." value={value.hasStormShelter} onChange={(v) => set({ hasStormShelter: v })} />
      <ToggleRow label="Attic you can get out of" detail="Has a window or roof hatch, not just a pull-down ladder." value={value.hasAtticAccess} onChange={(v) => set({ hasAtticAccess: v })} />
      <ToggleRow label="Attached garage" value={value.hasGarage} onChange={(v) => set({ hasGarage: v })} last />
    </View>
  );
}

/** Pick windowless ground-floor rooms, or type your own. */
export function InteriorRoomsPicker({ value, onChange }: { value: string[]; onChange: (rooms: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const custom = value.filter((r) => !INTERIOR_ROOM_OPTIONS.includes(r));
  const options = [...INTERIOR_ROOM_OPTIONS, ...custom];

  const toggle = (r: string) => onChange(value.includes(r) ? value.filter((x) => x !== r) : [...value, r]);
  const add = () => {
    const r = draft.trim();
    if (r && !value.includes(r)) onChange([...value, r]);
    setDraft('');
  };

  return (
    <View>
      <View style={st.chips}>
        {options.map((o) => {
          const on = value.includes(o);
          return (
            <Pressable
              key={o}
              onPress={() => toggle(o)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              style={[st.chip, on && st.chipOn]}>
              {on ? <Ionicons name="checkmark" size={16} color={color.white} /> : null}
              <T v="smallStrong" c={on ? color.white : color.ink}>
                {o}
              </T>
            </Pressable>
          );
        })}
      </View>
      <View style={st.addRow}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={add}
          placeholder="Type your own, like Wine cellar"
          placeholderTextColor="#A39996"
          returnKeyType="done"
          style={st.addInput}
        />
        <Pressable onPress={add} disabled={!draft.trim()} style={[st.addBtn, !draft.trim() && { opacity: 0.4 }]} accessibilityRole="button" accessibilityLabel="Add room">
          <Ionicons name="add" size={22} color={color.white} />
        </Pressable>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.lg },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.white,
  },
  chipOn: { backgroundColor: color.ink, borderColor: color.ink },
  addRow: { flexDirection: 'row', gap: space.sm },
  addInput: {
    flex: 1,
    backgroundColor: color.white,
    borderWidth: 1,
    borderColor: color.line,
    borderRadius: radius.sm,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: font.regular,
    fontSize: 16,
    color: color.ink,
  },
  addBtn: { width: 48, borderRadius: radius.sm, backgroundColor: color.ink, alignItems: 'center', justifyContent: 'center' },
});
