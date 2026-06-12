import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '@stores/authStore';

export default function Index() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isGuest = useAuthStore((s) => s.isGuest);
  const onboardingCompleted = useAuthStore((s) => s.onboardingCompleted);
  const [hydrated, setHydrated] = useState(() => useAuthStore.persist.hasHydrated());
  const [hasSeenIntro, setHasSeenIntro] = useState<boolean | null>(null);

  useEffect(() => {
    if (useAuthStore.persist.hasHydrated()) {
      return;
    }
    const unsub = useAuthStore.persist.onFinishHydration(() => {
      setHydrated(true);
    });
    return unsub;
  }, []);

  useEffect(() => {
    SecureStore.getItemAsync('hasSeenIntro').then((val) => {
      setHasSeenIntro(val === 'true');
    });
  }, []);

  if (!hydrated || hasSeenIntro === null) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!isAuthenticated && !isGuest) {
    if (!hasSeenIntro) {
      return <Redirect href="/intro" />;
    }
    return <Redirect href="/auth/sign-in" />;
  }

  if (isAuthenticated && !onboardingCompleted) {
    return <Redirect href="/onboarding" />;
  }

  return <Redirect href="/(tabs)/home" />;
}
