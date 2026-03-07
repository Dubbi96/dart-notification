import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { useAuthStore } from '@stores/authStore';
import { api } from '@services/api';

const KAKAO_REST_API_KEY = '551d536a94a299e7d4847dffc98ee51f';
const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000/api';
const REDIRECT_URI = `${API_BASE_URL}/auth/kakao/callback`;

export default function SignInScreen() {
  const { colors, typography: typo } = useTheme();
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
        const { data } = await api.get(`/auth/kakao/result?state=${state}`);
        if (data.success && data.data) {
          if (pollingRef.current) clearInterval(pollingRef.current);

          const { user, tokens, isNewUser } = data.data;
          setAuth(user, tokens.accessToken, tokens.refreshToken);
          SecureStore.setItemAsync('hasLoggedIn', 'true');
          setIsLoading(false);

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
      const state = Crypto.randomUUID();

      const authUrl =
        `https://kauth.kakao.com/oauth/authorize` +
        `?client_id=${KAKAO_REST_API_KEY}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&response_type=code` +
        `&state=${state}`;

      // Start polling before opening browser
      pollForResult(state);

      await WebBrowser.openBrowserAsync(authUrl);

      // Browser closed — give a few more seconds for polling
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
      Alert.alert('오류', '카카오 로그인 중 문제가 발생했습니다.');
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        {/* Logo Area */}
        <LinearGradient
          colors={[colors.cardGradientStart, colors.cardGradientEnd]}
          style={styles.logoArea}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <View style={styles.logoIcon}>
            <Ionicons name="pulse" size={40} color="#FFFFFF" />
          </View>
          <Text style={[typo.h1, { color: '#FFFFFF', marginTop: spacing.md }]}>
            DART 알리미
          </Text>
          <Text style={[typo.caption, { color: 'rgba(255,255,255,0.7)', marginTop: spacing.xs }]}>
            실시간 공시 알림 서비스
          </Text>
        </LinearGradient>

        {/* Login Area */}
        <View style={[styles.loginArea, { backgroundColor: colors.background }]}>
          <Text style={[typo.h2, { color: colors.text, textAlign: 'center' }]}>
            {hasLoggedInBefore ? '다시 만나서 반가워요!' : '환영합니다!'}
          </Text>
          <Text
            style={[
              typo.body,
              { color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
            ]}
          >
            소셜 계정으로 간편하게 시작하세요
          </Text>

          {/* Kakao Login Button */}
          <TouchableOpacity
            style={styles.kakaoButton}
            onPress={handleKakaoLogin}
            activeOpacity={0.8}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator size="small" color="#191919" />
            ) : (
              <>
                <Text style={styles.kakaoIcon}>{'💬'}</Text>
                <Text style={styles.kakaoButtonText}>카카오로 시작하기</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Terms */}
          <Text
            style={[
              typo.small,
              { color: colors.textTertiary, textAlign: 'center', marginTop: spacing.xl, lineHeight: 18 },
            ]}
          >
            로그인 시 서비스 이용약관 및{'\n'}개인정보 처리방침에 동의합니다.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  logoArea: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing['4xl'],
    paddingBottom: spacing['4xl'] + radius.xl,
  },
  logoIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEE500',
    borderRadius: radius.md,
    paddingVertical: 14,
    marginTop: spacing['2xl'],
    gap: spacing.sm,
  },
  kakaoIcon: {
    fontSize: 20,
  },
  kakaoButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#191919',
  },
});
