import { useState } from 'react';
import { View } from 'react-native';

import { HomeStructureForm, InteriorRoomsPicker } from '@/components/home-form';
import { Sheet } from '@/components/sheet';
import { Chips, Field, T } from '@/components/ui';
import { geocodeHome } from '@/lib/geocode';
import { useStore } from '@/lib/store';
import { color, space } from '@/lib/theme';

const TYPES = ['Single-family house', 'Townhouse', 'Apartment', 'Mobile home'];

export default function EditHome() {
  const { state, dispatch } = useStore();
  const [h, setH] = useState(state.home);
  const set = (k: 'street' | 'city' | 'state' | 'zip' | 'county' | 'accessNotes' | 'homeType') => (v: string) =>
    setH((p) => ({ ...p, [k]: v }));

  const save = () => {
    const addressChanged = h.street !== state.home.street || h.zip !== state.home.zip || h.city !== state.home.city;
    dispatch({ type: 'home', patch: { ...h, profileDone: true } });
    dispatch({ type: 'suggestRooms' }); // only fills hazards that don't have a room yet
    if (addressChanged || h.lat == null) {
      geocodeHome(h).then((c) => c && dispatch({ type: 'home', patch: c }));
    }
  };

  return (
    <Sheet title="Home" canSave={!!h.street.trim() && !!h.zip.trim()} onSave={save}>
      <Field label="Street address" value={h.street} onChangeText={set('street')} placeholder="2401 Elm Street" />
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <View style={{ flex: 2 }}>
          <Field label="City" value={h.city} onChangeText={set('city')} placeholder="Richardson" />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="State" value={h.state} onChangeText={set('state')} placeholder="TX" autoCapitalize="characters" maxLength={2} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Field label="ZIP" value={h.zip} onChangeText={set('zip')} placeholder="75080" keyboardType="number-pad" maxLength={5} />
        </View>
        <View style={{ flex: 2 }}>
          <Field label="County" value={h.county} onChangeText={set('county')} placeholder="Dallas County" />
        </View>
      </View>

      <T v="smallStrong" style={{ marginBottom: 6 }}>
        Type of home
      </T>
      <Chips options={TYPES} value={h.homeType} onChange={set('homeType')} />

      <T v="heading" style={{ marginTop: space.sm, marginBottom: space.sm }}>
        What your home has
      </T>
      <HomeStructureForm value={h} onChange={(p) => setH((x) => ({ ...x, ...p }))} />

      <T v="heading" style={{ marginTop: space.xl }}>
        Rooms without windows
      </T>
      <T v="small" c={color.inkSoft} style={{ marginTop: 2, marginBottom: space.md }}>
        On the ground floor. These become your tornado and hurricane options.
      </T>
      <InteriorRoomsPicker value={h.interiorRooms} onChange={(rooms) => setH((x) => ({ ...x, interiorRooms: rooms }))} />

      <View style={{ marginTop: space.xl }}>
        <Field
          label="Access notes for responders"
          value={h.accessNotes}
          onChangeText={set('accessNotes')}
          multiline
          placeholder="Gate code 4417. Spare key in the lockbox by the side door. Gas shutoff on the east wall."
          hint="Gate codes, spare keys, dogs, and where the gas and water shutoffs are."
        />
      </View>
    </Sheet>
  );
}
