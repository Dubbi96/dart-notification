import React, { useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Surface, Button } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';

// 게스트(비로그인) 전용 로그인 유도 뷰(DAR-113).
// 인증 필요(401) 화면/섹션에서 '불러오지 못했습니다' 에러·빈 화면 대신,
// 가치 프리뷰 + 로그인 CTA로 자연스럽게 로그인 동선을 연다(버그 오인 방지).
// 정직 원칙: 과대약속 금지 — 카피는 guestPromptCopy 정본 테이블에서만 관리.

const SIGN_IN_ROUTE = '/auth/sign-in' as const;

interface GuestPromptProps {
  icon?: keyof typeof Feather.glyphMap;
  title: string;
  description?: string;
  /** 로그인 시 열리는 가치 항목(정직 프리뷰). 'screen' variant에서만 노출. */
  benefits?: string[];
  ctaLabel?: string;
  /** 로그인 CTA 동작. 기본은 sign-in 화면 이동. */
  onLogin?: () => void;
  /** 'screen' 전체화면 중앙 / 'card' 슬롯 내 카드. */
  variant?: 'screen' | 'card';
  /** 로그인 없이 볼 수 있는 보조 동선(예: 공시 둘러보기) — screen variant. */
  secondaryLabel?: string;
  onSecondary?: () => void;
}

export function GuestPrompt({
  icon = 'lock',
  title,
  description,
  benefits,
  ctaLabel = '로그인',
  onLogin,
  variant = 'screen',
  secondaryLabel,
  onSecondary,
}: GuestPromptProps) {
  const { colors, typography: typo } = useTheme();

  const handleLogin = useCallback(() => {
    if (onLogin) onLogin();
    else router.push(SIGN_IN_ROUTE);
  }, [onLogin]);

  if (variant === 'card') {
    // 홈 프리뷰 슬롯 등 좁은 영역: 아이콘 배지 + 카피 + CTA를 카드 1장에.
    return (
      <Surface
        elevation={0}
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <View style={[styles.cardIcon, { backgroundColor: colors.primaryLight }]}>
          <Feather name={icon} size={20} color={colors.primary} />
        </View>
        <Text
          style={[typo.bodyMedium, { color: colors.text, marginTop: spacing.sm, textAlign: 'center' }]}
        >
          {title}
        </Text>
        {description ? (
          <Text
            style={[typo.small, { color: colors.textSecondary, marginTop: spacing.xs, textAlign: 'center' }]}
          >
            {description}
          </Text>
        ) : null}
        <Button
          mode="contained"
          onPress={handleLogin}
          style={styles.cardCta}
          accessibilityLabel={`${ctaLabel} — ${title}`}
        >
          {ctaLabel}
        </Button>
      </Surface>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.screenIcon, { backgroundColor: colors.primaryLight }]}>
        <Feather name={icon} size={32} color={colors.primary} />
      </View>
      <Text style={[typo.h3, { color: colors.text, marginTop: spacing.lg, textAlign: 'center' }]}>
        {title}
      </Text>
      {description ? (
        <Text
          style={[typo.caption, { color: colors.textSecondary, marginTop: spacing.sm, textAlign: 'center' }]}
        >
          {description}
        </Text>
      ) : null}
      {benefits && benefits.length > 0 ? (
        <View style={styles.benefits}>
          {benefits.map((b) => (
            <View key={b} style={styles.benefitRow}>
              <Feather name="check" size={16} color={colors.primary} />
              <Text style={[typo.caption, { color: colors.textSecondary, flex: 1 }]}>{b}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Button
        mode="contained"
        onPress={handleLogin}
        style={styles.screenCta}
        contentStyle={styles.screenCtaContent}
        accessibilityLabel={`${ctaLabel} — ${title}`}
      >
        {ctaLabel}
      </Button>
      {secondaryLabel && onSecondary ? (
        <Button mode="text" onPress={onSecondary} style={styles.secondary}>
          {secondaryLabel}
        </Button>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingTop: 80,
  },
  screenIcon: {
    width: 72,
    height: 72,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  benefits: {
    alignSelf: 'stretch',
    marginTop: spacing.lg,
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  benefitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  screenCta: {
    marginTop: spacing.xl,
    alignSelf: 'stretch',
  },
  screenCtaContent: {
    paddingVertical: spacing.xs,
  },
  secondary: {
    marginTop: spacing.sm,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    alignItems: 'center',
  },
  cardIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardCta: {
    marginTop: spacing.md,
    alignSelf: 'stretch',
  },
});
