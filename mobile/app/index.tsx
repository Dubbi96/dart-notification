import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '@stores/authStore';
import { useTheme } from '@theme';

export default function Index() {
  const { colors } = useTheme();
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
    // 콜드스타트 로딩: 배경 토큰을 적용해 다크모드 흰 플래시를 제거하고
    // 인디케이터에 primary 색을 지정한다(A-IDX-1).
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: colors.background,
        }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
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

  return <Redirect href="/(tabs)/signals" />;
}
