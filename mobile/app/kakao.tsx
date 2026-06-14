import { useEffect, useRef } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as SecureStore from 'expo-secure-store';
import { api } from '@services/api';
import { useAuthStore } from '@stores/authStore';
import { useTheme } from '@theme';

/**
 * 카카오 로그인 딥링크 콜백 (gongsion://kakao?state=...|error=...)
 * 백엔드 콜백이 이 딥링크로 리다이렉트 → Expo Router가 이 화면으로 라우팅.
 * state로 결과를 조회해 인증 설정 후 홈/온보딩으로 이동한다.
 */
export default function KakaoCallback() {
  const { colors } = useTheme();
  const { state, error } = useLocalSearchParams<{ state?: string; error?: string }>();
  const setAuth = useAuthStore((s) => s.setAuth);
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;

    // 딥링크로 앱 복귀 시 뒤에 남아있는 브라우저 탭 정리
    // dismissBrowser()는 SDK 버전에 따라 void를 반환할 수 있어 .catch 직접 호출 시 크래시 → try/catch로 방어
    try {
      void WebBrowser.dismissBrowser();
    } catch {
      // 정리 실패는 무시(앱 복귀 흐름에 영향 없음)
    }

    // 로그인 결과(/auth/kakao/result)는 백엔드에서 1회성으로 소비된다.
    // sign-in.tsx의 인라인 핸들러/폴링이 먼저 결과를 소비하면 이 딥링크 경로는
    // success:false 를 받는다. 이때 이미 인증된 상태라면 로그인 화면이 아니라 홈으로 보낸다(레이스 가드).
    function settleToHome(isNewUser: boolean) {
      router.replace(isNewUser ? '/onboarding' : '/(tabs)/home');
    }

    async function complete() {
      if (error) {
        // 이미 다른 경로(폴링/인라인)에서 인증을 마쳤으면 로그인 화면으로 되돌리지 않는다.
        if (useAuthStore.getState().isAuthenticated) {
          settleToHome(false);
          return;
        }
        router.replace('/auth/sign-in');
        return;
      }
      if (!state) {
        if (useAuthStore.getState().isAuthenticated) {
          settleToHome(false);
          return;
        }
        router.replace('/auth/sign-in');
        return;
      }
      try {
        const { data } = await api.get(`/auth/kakao/result?state=${encodeURIComponent(state)}`);
        if (data?.success && data?.data) {
          const { tokens, isNewUser } = data.data;
          setAuth(tokens.accessToken, tokens.refreshToken);
          SecureStore.setItemAsync('hasLoggedIn', 'true').catch(() => {});
          settleToHome(isNewUser);
          return;
        }
      } catch {
        // 결과 조회 실패 → 인증상태에 따라 분기(아래)
      }
      // 결과가 없거나(이미 소비됨) 조회 실패 — 다른 경로에서 인증을 마쳤다면 홈으로,
      // 그렇지 않으면 로그인 화면으로.
      if (useAuthStore.getState().isAuthenticated) {
        settleToHome(false);
        return;
      }
      router.replace('/auth/sign-in');
    }

    complete();
  }, [state, error, setAuth]);

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ActivityIndicator size="large" color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
