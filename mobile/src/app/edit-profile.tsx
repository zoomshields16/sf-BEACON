import { toE164 } from '@/lib/api';
import { useState } from 'react';

import { Sheet } from '@/components/sheet';
import { Field } from '@/components/ui';
import { useStore } from '@/lib/store';

export default function EditProfile() {
  const { state, dispatch } = useStore();
  const [u, setU] = useState(state.user);

  return (
    <Sheet title="Your details" canSave={!!u.name.trim() && !!toE164(u.phone)} onSave={() => dispatch({ type: 'user', patch: u })}>
      <Field label="Full name" value={u.name} onChangeText={(v) => setU({ ...u, name: v })} autoCapitalize="words" />
      <Field
        label="Mobile number"
        value={u.phone}
        onChangeText={(v) => setU({ ...u, phone: v })}
        keyboardType="phone-pad"
        hint="This is the number we call if you don't check in."
      />
      <Field
        label="Email"
        value={u.email}
        onChangeText={(v) => setU({ ...u, email: v })}
        keyboardType="email-address"
        autoCapitalize="none"
      />
    </Sheet>
  );
}
