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
import { spacing, radius } from '@theme/spacing';
import { useDialog } from '@components/common/DialogProvider';
import LogoCards from '@/assets/logo/logo-cards.svg';
import { useAuthStore } from '@stores/authStore';
import { api } from '@services/api';

// 카카오 REST API 키 — mobile/.env 의 EXPO_PUBLIC_KAKAO_REST_API_KEY 로 주입 (백엔드 KAKAO_REST_API_KEY 와 동일 앱)
const KAKAO_REST_API_KEY = process.env.EXPO_PUBLIC_KAKAO_REST_API_KEY || '';
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api';
const REDIRECT_URI = `${API_BASE_URL}/auth/kakao/callback`;

export default function SignInScreen() {
  const { colors, typography: typo } = useTheme();
  const { showDialog } = useDialog();
  const [hasLoggedInBefore, setHasLoggedInBefore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { setAuth } = useAuthStore();
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    SecureStore.getItemAsync('hasLoggedIn').then((value) => {
      if (value === 'true') setHasLoggedInBefore(true);
    });
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const pollForResult = (state: string) => {
    let attempts = 0;
    pollingRef.current = setInterval(async () => {
      attempts++;
      if (attempts > 60) {
        // 60초 타임아웃
        if (pollingRef.current) clearInterval(pollingRef.current);
        setIsLoading(false);
        return;
      }

      try {
        const { data } = await api.get(`/auth/kakao/result?state=${encodeURIComponent(state)}`);
        if (data.success && data.data) {
          if (pollingRef.current) clearInterval(pollingRef.current);

          const { user, tokens, isNewUser } = data.data;
          setAuth(user, tokens.accessToken, tokens.refreshToken);
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
        try {
          const { data } = await api.get(
            `/auth/kakao/result?state=${encodeURIComponent(state)}`,
          );
          if (data?.success && data?.data) {
            if (pollingRef.current) clearInterval(pollingRef.current);
            const { user, tokens, isNewUser } = data.data;
            setAuth(user, tokens.accessToken, tokens.refreshToken);
            SecureStore.setItemAsync('hasLoggedIn', 'true');
            setIsLoading(false);
            router.replace(isNewUser ? '/onboarding' : '/(tabs)/home');
            return;
          }
        } catch {
          // 폴링 폴백에 맡김
        }
      }

      // 취소/실패 — 폴링이 아직 결과 못 받았으면 잠시 더 대기 후 정리
      setTimeout(() => {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        setIsLoading(false);
      }, 5000);
    } catch (e) {
      if (pollingRef.current) clearInterval(pollingRef.current);
      setIsLoading(false);
      showDialog({ title: '오류', message: '카카오 로그인 중 문제가 발생했습니다.', icon: { name: 'alert-circle', color: '#EF4444' } });
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
          <Text style={[{ fontSize: 60, fontWeight: '300', color: '#FFFFFF' }]}>
            공시<Text style={{ color: '#2DD4BF', fontWeight: '700' }}>온</Text>
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
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="#191919" />
            ) : (
              <Image
                source={require('../../assets/kakao_login_large_wide.png')}
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
            onPress={() => {
              useAuthStore.getState().enterGuest();
              router.replace('/(tabs)/home');
            }}
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
