import { useEffect } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuthStore } from '@stores/authStore';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';

// dev 전용 테스트 로그인 라우트 — 인증 필요 화면의 에뮬레이터 검증·Maestro 스모크(W15 ②)용.
// 카카오 웹플로우를 자동화하는 대신, 외부에서 발급한 토큰을 딥링크 파라미터로 주입한다.
//   예) gongsion://dev-login?access=<jwt>&refresh=<jwt>&id=<uid>
//       exp://<host>/--/dev-login?access=<jwt>&refresh=<jwt>&id=<uid>
// 주입 토큰은 백엔드 서명 JWT 여야 하므로 인증 우회가 아니다(무효 토큰은 API 401).
// 게이트: __DEV__ 또는 EXPO_PUBLIC_ALLOW_DEV_LOGIN=true(스모크용 빌드) — 그 외엔 즉시 루트로.
const DEV_LOGIN_ENABLED = __DEV__ || process.env.EXPO_PUBLIC_ALLOW_DEV_LOGIN === 'true';

export default function DevLogin() {
  const { colors, typography: typo } = useTheme();
  const params = useLocalSearchParams<{
    access?: string;
    refresh?: string;
    id?: string;
  }>();

  useEffect(() => {
    if (!DEV_LOGIN_ENABLED) {
      router.replace('/');
      return;
    }
    const { access, refresh, id } = params;
    if (access && refresh && id) {
      // DAR-262: setAuth 는 토큰만 저장(user 프로필은 useMe().data SSOT). 주입 토큰으로 useMe 가 실 user fetch.
      const store = useAuthStore.getState();
      store.setAuth(access, refresh);
      store.completeOnboarding();
      router.replace('/(tabs)/signals');
    } else {
      router.replace('/');
    }
    // params 는 딥링크 진입 시점 1회 처리 의도 — 의존성 비움.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={[typo.body, styles.text, { color: colors.textSecondary }]}>
        테스트 로그인 처리 중…
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  text: { marginTop: spacing.md },
});
