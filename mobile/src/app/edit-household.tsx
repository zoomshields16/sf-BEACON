import { useState } from 'react';
import { View } from 'react-native';

import { Sheet } from '@/components/sheet';
import { Field, s, Stepper, T } from '@/components/ui';
import { useStore } from '@/lib/store';
import { color, space } from '@/lib/theme';

export default function EditHousehold() {
  const { state, dispatch } = useStore();
  const [hh, setHh] = useState(state.household);

  return (
    <Sheet title="Who lives here" onSave={() => dispatch({ type: 'household', patch: hh })}>
      <T v="small" c={color.inkSoft} style={{ marginBottom: space.md }}>
        Responders use this to know how many people to look for.
      </T>
      <View style={[s.group, { marginBottom: space.xl }]}>
        <Stepper label="Adults" value={hh.adults} onChange={(n) => setHh({ ...hh, adults: n })} />
        <Stepper label="Children" value={hh.children} onChange={(n) => setHh({ ...hh, children: n })} />
        <Stepper label="Pets" value={hh.pets} onChange={(n) => setHh({ ...hh, pets: n })} last />
      </View>
      <Field
        label="Medical or mobility needs"
        value={hh.needs}
        onChangeText={(v) => setHh({ ...hh, needs: v })}
        multiline
        placeholder="Grandmother uses a wheelchair. Oxygen tank in the main bedroom."
        hint="Only shared with 911 when you ask for help or don't respond."
      />
    </Sheet>
  );
}
