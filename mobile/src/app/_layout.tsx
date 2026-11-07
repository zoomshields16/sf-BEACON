import {
  PublicSans_400Regular,
  PublicSans_500Medium,
  PublicSans_600SemiBold,
  PublicSans_700Bold,
  PublicSans_800ExtraBold,
  useFonts,
} from '@expo-google-fonts/public-sans';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { StoreProvider, useStore } from '@/lib/store';
import { color } from '@/lib/theme';

SplashScreen.preventAutoHideAsync();

function RootStack() {
  const { ready } = useStore();
  const [fontsLoaded] = useFonts({
    PublicSans_400Regular,
    PublicSans_500Medium,
    PublicSans_600SemiBold,
    PublicSans_700Bold,
    PublicSans_800ExtraBold,
  });

  useEffect(() => {
    if (ready && fontsLoaded) SplashScreen.hideAsync();
  }, [ready, fontsLoaded]);

  if (!ready || !fontsLoaded) return null;

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.paper } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="onboarding" options={{ gestureEnabled: false }} />
        <Stack.Screen name="(tabs)" options={{ gestureEnabled: false }} />
        {/* Plain full-screen card (not a native modal) so safe-area insets are always correct under the Dynamic Island. */}
        <Stack.Screen name="check-in" options={{ gestureEnabled: false, animation: 'fade' }} />
        <Stack.Screen name="weather" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="safe-room/[hazard]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="contact/[id]" options={{ presentation: 'modal' }} />
        <Stack.Screen name="edit-home" options={{ presentation: 'modal' }} />
        <Stack.Screen name="edit-household" options={{ presentation: 'modal' }} />
        <Stack.Screen name="edit-profile" options={{ presentation: 'modal' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <StoreProvider>
        <RootStack />
      </StoreProvider>
    </SafeAreaProvider>
  );
}
