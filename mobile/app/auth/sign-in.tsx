import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as Linking from 'expo-linking';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { palette } from '@theme/colors';
import { spacing, radius } from '@theme/spacing';
import { useDialog } from '@components/common/DialogProvider';
import LogoCards from '@/assets/logo/logo-cards.svg';
import kakaoLoginImage from '../../assets/kakao_login_large_wide.png';
import { useAuthStore } from '@stores/authStore';
import { api, API_BASE_URL } from '@services/api';
import { createMountGuard, type TimerHandle } from '@utils/mountGuard';

// 카카오 REST API 키 — mobile/.env 의 EXPO_PUBLIC_KAKAO_REST_API_KEY 로 주입 (백엔드 KAKAO_REST_API_KEY 와 동일 앱)
const KAKAO_REST_API_KEY = process.env.EXPO_PUBLIC_KAKAO_REST_API_KEY || '';
// redirect_uri 는 api.ts의 단일 API_BASE_URL 기준. 카카오 콘솔에도 이 값이 등록돼 있어야 한다(README 참조).
const REDIRECT_URI = `${API_BASE_URL}/auth/kakao/callback`;

export default function SignInScreen() {
  const { colors, typography: typo } = useTheme();
  const { showDialog } = useDialog();
  const [hasLoggedInBefore, setHasLoggedInBefore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { setAuth } = useAuthStore();
  const pollingRef = useRef<TimerHandle | null>(null);
  // 언마운트 후 setState·콜백·타이머 누수 차단(DAR-228). 렌더 간 안정적인 단일 인스턴스.
  const guardRef = useRef<ReturnType<typeof createMountGuard> | null>(null);
  if (guardRef.current === null) {
    guardRef.current = createMountGuard();
  }
  const guard = guardRef.current;

  useEffect(() => {
    SecureStore.getItemAsync('hasLoggedIn').then((value) => {
      guard.run(() => {
        if (value === 'true') setHasLoggedInBefore(true);
      });
    });
    return () => {
      // 마운트 플래그를 내리고 등록된 interval·timeout 을 일괄 해제.
      guard.cleanup();
      pollingRef.current = null;
    };
  }, [guard]);

  // 게스트(둘러보기) 진입 — 로그인 실패/미진입 시 공시 둘러보기 동선(DAR-43 §2).
  const goGuest = () => {
    useAuthStore.getState().enterGuest();
    router.replace('/(tabs)/home');
  };

  // 카카오 로그인 실패 사유를 표면화하고 둘러보기 대안을 함께 제시(DAR-43 §3).
  const showKakaoFailure = (message: string) => {
    showDialog({
      title: '카카오 로그인 실패',
      message,
      icon: { name: 'alert-circle', color: palette.red500 },
      buttons: [
        { text: '닫기', style: 'cancel' },
        { text: '둘러보기', onPress: goGuest },
      ],
    });
  };

  const pollForResult = (state: string) => {
    let attempts = 0;
    // guard.setInterval: 매 tick 은 마운트 상태에서만 실행되고, 언마운트 cleanup 시 자동 해제된다.
    pollingRef.current = guard.setInterval(async () => {
      attempts++;

      // 인라인 핸들러/딥링크가 이미 결과를 소비해 인증을 마쳤으면 폴링을 중단한다.
      // (백엔드 결과는 1회성이라 중복 조회는 success:false → 불필요한 타임아웃 실패 다이얼로그 유발)
      if (useAuthStore.getState().isAuthenticated) {
        guard.clearTimer(pollingRef.current);
        pollingRef.current = null;
        setIsLoading(false);
        return;
      }

      if (attempts > 60) {
        // 60초 타임아웃 — 서버 연결/카카오 redirect_uri 등록을 점검하도록 안내.
        guard.clearTimer(pollingRef.current);
        pollingRef.current = null;
        setIsLoading(false);
        showKakaoFailure(
          '로그인 응답을 받지 못했습니다(60초 초과). 서버 연결 상태와 카카오 redirect_uri 등록을 확인해 주세요.',
        );
        return;
      }

      try {
        const { data } = await api.get(`/auth/kakao/result?state=${encodeURIComponent(state)}`);
        if (data.success && data.data) {
          guard.clearTimer(pollingRef.current);
          pollingRef.current = null;
          // await 해소가 언마운트 후 도착하면 setState·네비게이션을 중단한다(DAR-228).
          if (!guard.isMounted()) return;

          const { tokens, isNewUser } = data.data;
          setAuth(tokens.accessToken, tokens.refreshToken);
          SecureStore.setItemAsync('hasLoggedIn', 'true');
          setIsLoading(false);

          // Close the in-app browser before navigating
          WebBrowser.dismissBrowser();

          if (isNewUser) {
            router.replace('/onboarding');
          } else {
            router.replace('/(tabs)/home');
          }
        }
      } catch {
        // Keep polling
      }
    }, 1000);
  };

  const handleKakaoLogin = async () => {
    try {
      setIsLoading(true);

      // 환경에 맞는 앱 복귀 URL (Expo Go: exp://.../--/kakao, 빌드: gongsion://kakao)
      const returnUrl = Linking.createURL('kakao');
      // state 에 복귀 URL 을 실어 보낸다 → 백엔드가 이 URL 로 리다이렉트
      const nonce = Crypto.randomUUID();
      const state = `${nonce}~${encodeURIComponent(returnUrl)}`;

      const authUrl =
        `https://kauth.kakao.com/oauth/authorize` +
        `?client_id=${KAKAO_REST_API_KEY}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&response_type=code` +
        `&state=${encodeURIComponent(state)}`;

      // 폴백 폴링 시작
      pollForResult(state);

      // returnUrl 로 리다이렉트되면 openAuthSessionAsync 가 감지해 브라우저 자동 종료 후 복귀
      const result = await WebBrowser.openAuthSessionAsync(authUrl, returnUrl);

      if (result.type === 'success') {
        // 백엔드 콜백이 redirect_uri mismatch 등 카카오 에러를 returnUrl?error= 로 실어 복귀시킨다 → 사유 표면화(DAR-43 §3).
        const parsed = Linking.parse(result.url);
        const rawErr = parsed.queryParams?.error;
        const kakaoErr = Array.isArray(rawErr) ? rawErr[0] : rawErr;
        if (kakaoErr) {
          guard.clearTimer(pollingRef.current);
          pollingRef.current = null;
          // 브라우저 세션 종료가 언마운트 후 해소될 수 있으므로 가드한다(DAR-228).
          guard.run(() => {
            setIsLoading(false);
            showKakaoFailure(decodeURIComponent(kakaoErr));
          });
          return;
        }
        try {
          const { data } = await api.get(
            `/auth/kakao/result?state=${encodeURIComponent(state)}`,
          );
          if (data?.success && data?.data) {
            guard.clearTimer(pollingRef.current);
            pollingRef.current = null;
            if (!guard.isMounted()) return;
            const { tokens, isNewUser } = data.data;
            setAuth(tokens.accessToken, tokens.refreshToken);
            SecureStore.setItemAsync('hasLoggedIn', 'true');
            setIsLoading(false);
            router.replace(isNewUser ? '/onboarding' : '/(tabs)/home');
            return;
          }
        } catch {
          // 폴링 폴백에 맡김
        }
      }

      // 취소/실패 — 폴링이 아직 결과 못 받았으면 잠시 더 대기 후 정리.
      // guard.setTimeout: 콜백은 마운트 상태에서만 실행되고, 언마운트 cleanup 시 자동 해제된다(DAR-228).
      guard.setTimeout(() => {
        if (pollingRef.current) {
          guard.clearTimer(pollingRef.current);
          pollingRef.current = null;
        }
        setIsLoading(false);
      }, 5000);
    } catch (e) {
      guard.clearTimer(pollingRef.current);
      pollingRef.current = null;
      // 외부 await throw 가 언마운트 후 도착할 수 있으므로 가드한다(DAR-228).
      guard.run(() => {
        setIsLoading(false);
        showKakaoFailure('카카오 로그인 중 문제가 발생했습니다. 네트워크 연결을 확인해 주세요.');
      });
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={[colors.cardGradientStart, colors.cardGradientEnd]}
        style={styles.logoGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      <SafeAreaView style={styles.content}>
        {/* Logo Area */}
        <View style={styles.logoArea}>
          <Text style={{ fontSize: 60, fontWeight: '300', color: palette.white }}>
            공시<Text style={{ color: palette.teal400, fontWeight: '700' }}>온</Text>
          </Text>
          <Text style={[typo.caption, { color: 'rgba(255,255,255,0.5)', marginTop: spacing.sm }]}>
            실시간 DART 공시 알리미
          </Text>
          <LogoCards width={300} height={150} style={{ marginTop: spacing.sm }} />
        </View>

        {/* Login Area */}
        <View style={[styles.loginArea, { backgroundColor: colors.background }]}>
          <Text style={[typo.h1, { color: colors.text, textAlign: 'center' }]}>
            {hasLoggedInBefore ? '다시 만나서 반가워요!' : '환영합니다!'}
          </Text>
          <Text
            style={[
              typo.h3,
              { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm, fontWeight: '400' },
            ]}
          >
            소셜 계정으로 간편하게 시작하세요
          </Text>

          {/* Kakao Login Button */}
          <TouchableOpacity
            onPress={handleKakaoLogin}
            activeOpacity={0.8}
            disabled={isLoading}
            style={styles.kakaoButton}
            accessibilityRole="button"
            accessibilityLabel="카카오로 로그인"
            accessibilityState={{ disabled: isLoading }}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color={palette.gray900} />
            ) : (
              <Image
                source={kakaoLoginImage}
                style={styles.kakaoImage}
                resizeMode="contain"
              />
            )}
          </TouchableOpacity>

          {/* Terms */}
          <Text
            style={[
              typo.small,
              { color: colors.textTertiary, textAlign: 'center', marginTop: spacing.xl, lineHeight: 18 },
            ]}
          >
            로그인 시{' '}
            <Text
              style={{ color: colors.primary, textDecorationLine: 'underline' }}
              onPress={() => router.push('/legal/terms')}
            >
              서비스 이용약관
            </Text>
            {' 및\n'}
            <Text
              style={{ color: colors.primary, textDecorationLine: 'underline' }}
              onPress={() => router.push('/legal/privacy')}
            >
              개인정보 처리방침
            </Text>
            에 동의합니다.
          </Text>

          {/* Guest Browse */}
          <TouchableOpacity
            style={styles.guestButton}
            onPress={goGuest}
            activeOpacity={0.7}
          >
            <Text style={[typo.caption, { color: colors.textSecondary }]}>
              로그인 없이 둘러보기
            </Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  logoGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '60%',
  },
  content: {
    flex: 1,
  },
  logoArea: {
    alignItems: 'center',
    paddingTop: spacing['4xl'] * 1.5,
    paddingBottom: spacing['2xl'] + radius.xl,
  },
  loginArea: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    marginTop: -radius.xl,
  },
  kakaoButton: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing['2xl'],
    height: 52,
    borderRadius: radius.md,
    overflow: 'hidden',
  },
  kakaoImage: {
    width: '100%',
    height: '100%',
    borderRadius: radius.md,
  },
  guestButton: {
    alignItems: 'center',
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
  },
});
