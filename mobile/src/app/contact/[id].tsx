import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';

import { Sheet } from '@/components/sheet';
import { Button, Chips, Field } from '@/components/ui';
import { useStore } from '@/lib/store';

const RELATIONS = ['Partner', 'Parent', 'Child', 'Sibling', 'Neighbor', 'Friend'];

export default function EditContact() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, dispatch } = useStore();
  const existing = state.contacts.find((c) => c.id === id);

  const [name, setName] = useState(existing?.name ?? '');
  const [relation, setRelation] = useState(existing?.relation ?? '');
  const [phone, setPhone] = useState(existing?.phone ?? '');

  return (
    <Sheet
      title={existing ? 'Edit contact' : 'New contact'}
      canSave={!!name.trim() && !!phone.trim()}
      onSave={() =>
        dispatch({
          type: 'saveContact',
          contact: { id: existing?.id ?? String(Date.now()), name: name.trim(), relation, phone: phone.trim() },
        })
      }>
      <Field label="Name" value={name} onChangeText={setName} placeholder="Jordan Rivera" autoCapitalize="words" />
      <Field label="Phone" value={phone} onChangeText={setPhone} placeholder="(214) 555-0142" keyboardType="phone-pad" />
      <Chips options={RELATIONS} value={relation} onChange={setRelation} />
      {existing ? (
        <Button
          kind="ghost"
          label="Remove contact"
          onPress={() => {
            dispatch({ type: 'removeContact', id: existing.id });
            router.back();
          }}
        />
      ) : null}
    </Sheet>
  );
}
