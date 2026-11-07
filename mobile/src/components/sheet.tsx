import { router } from 'expo-router';
import { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';

import { SheetHeader } from '@/components/ui';
import { color, space } from '@/lib/theme';

/** Shared shell for every edit screen (presented as an iOS modal sheet). */
export function Sheet({
  title,
  onSave,
  canSave,
  children,
}: {
  title: string;
  onSave: () => void;
  canSave?: boolean;
  children: ReactNode;
}) {
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: color.paper }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <SheetHeader
        title={title}
        onCancel={() => router.back()}
        onSave={() => {
          onSave();
          router.back();
        }}
        canSave={canSave}
      />
      <ScrollView contentContainerStyle={{ padding: space.lg, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <View>{children}</View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
