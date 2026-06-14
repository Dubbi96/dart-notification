import React from 'react';
import { View, Text, StyleSheet, Pressable, useColorScheme } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { getTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { resolveFallbackScheme, ERROR_FALLBACK_COPY } from '@utils/errorBoundary';

import type { ErrorBoundaryProps } from 'expo-router';

// DAR-224: 앱 전역 단일 안전망 폴백 UI.
// Expo Router는 레이아웃/라우트에서 `export function ErrorBoundary` 를 내보내면
// 서브트리 렌더타임 에러를 격리하고 이 컴포넌트를 대신 렌더한다(프로덕션 백지/크래시 차단).
//
// 주의: 루트 레이아웃 자체가 throw 하면 폴백은 ThemeContext/PaperProvider 바깥에서 렌더된다.
//  - 테마: useTheme()(context) 대신 시스템 컬러스킴으로 getTheme 직접 파생.
//  - 버튼: react-native-paper Button(Provider/Portal 의존) 대신 RN 코어 Pressable.
// → 어떤 provider 도 마운트되지 않은 상태에서도 안전하게 그려진다.
export function ErrorFallback({ retry }: ErrorBoundaryProps) {
  const scheme = useColorScheme();
  const { colors, typography: typo } = getTheme(resolveFallbackScheme(scheme));

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <Feather name="alert-triangle" size={48} color={colors.error} />
      <Text style={[typo.bodyMedium, styles.title, { color: colors.text }]}>
        {ERROR_FALLBACK_COPY.title}
      </Text>
      <Text style={[typo.caption, styles.description, { color: colors.textSecondary }]}>
        {ERROR_FALLBACK_COPY.description}
      </Text>
      <Pressable
        onPress={retry}
        accessibilityRole="button"
        accessibilityLabel={ERROR_FALLBACK_COPY.retry}
        hitSlop={8}
        style={({ pressed }) => [
          styles.retryButton,
          { borderColor: colors.primary, opacity: pressed ? 0.7 : 1 },
        ]}
      >
        <Feather name="refresh-cw" size={18} color={colors.primary} />
        <Text style={[typo.bodyMedium, { color: colors.primary, marginLeft: spacing.xs }]}>
          {ERROR_FALLBACK_COPY.retry}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  title: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
  description: {
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    marginTop: spacing.lg,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderRadius: radius.md,
  },
});
