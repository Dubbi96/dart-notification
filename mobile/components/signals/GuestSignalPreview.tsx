import React, { useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Surface, Button } from 'react-native-paper';
import { BlurView } from 'expo-blur';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { guestPromptCopy } from '@components/common/guestPromptCopy';
import { guestPreviewCards, GUEST_PREVIEW_COPY, type GuestPreviewCard } from '@utils/guestSignalPreview';

// DAR-213: 게스트 신호 탭 read-only 미리보기.
// 신호 엔드포인트는 401(인증 필요)이라 게스트는 실데이터를 받을 수 없다. 기존엔
// GuestPrompt만 노출돼 '가치 체험' 경로가 홈 1건뿐이었다. 여기서 신호 카드 '구조'를
// 블러+잠금 오버레이로 직접 맛보게 하고 로그인 CTA로 자연스럽게 동선을 연다.
// 정직 원칙: 실종목·실점수·실등급 비노출 — 마스킹된 '예시' 실루엣만(guestSignalPreview 정본).

const SIGN_IN_ROUTE = '/auth/sign-in' as const;
const PREVIEW_COUNT = 2;

interface GuestSignalPreviewProps {
  /** 로그인 없이 볼 수 있는 보조 동선(공시 둘러보기 등). */
  secondaryLabel?: string;
  onSecondary?: () => void;
}

/** 잠금 미리보기 카드(§블러+오버레이) — 실데이터 아님을 '예시' 배지로 명시. */
function LockedPreviewCard({ card }: { card: GuestPreviewCard }) {
  const { colors, typography: typo, isDark } = useTheme();
  return (
    <Surface
      elevation={1}
      // 카드 내부는 잠금 미리보기 단위 — 스크린리더는 오버레이 라벨만 읽는다.
      importantForAccessibility="no-hide-descendants"
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      {/* 실루엣(블러 아래) — 신호 카드 구조: 종목명 + 등급칩 + 점수 게이지바. */}
      <View style={styles.cardHeader}>
        <Text style={[typo.bodyMedium, styles.flex1, { color: colors.text }]} numberOfLines={1}>
          {card.maskedName}
        </Text>
        <View style={[styles.gradeChip, { backgroundColor: colors.surfaceSecondary }]}>
          <View style={[styles.maskBar, styles.maskBarChip, { backgroundColor: colors.textTertiary }]} />
        </View>
      </View>
      <View style={[styles.gaugeTrack, { backgroundColor: colors.surfaceSecondary }]}>
        <View style={[styles.gaugeFill, { backgroundColor: colors.primary, width: `${card.fill * 100}%` }]} />
      </View>
      <View style={[styles.maskBar, styles.maskBarLine, { backgroundColor: colors.borderLight }]} />

      {/* 블러 + 잠금 오버레이 — 수치를 읽을 수 없게 덮고 로그인 유도. */}
      <BlurView intensity={18} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
      <View style={[styles.exampleBadge, { backgroundColor: colors.overlay }]}>
        <Text style={[typo.small, { color: colors.textInverse }]}>{GUEST_PREVIEW_COPY.exampleBadge}</Text>
      </View>
      <View style={styles.lockBadge} pointerEvents="none">
        <View style={[styles.lockPill, { backgroundColor: colors.overlay }]}>
          <Feather name="lock" size={14} color={colors.textInverse} />
          <Text style={[typo.captionMedium, { color: colors.textInverse }]}>
            {GUEST_PREVIEW_COPY.lockBadge}
          </Text>
        </View>
      </View>
    </Surface>
  );
}

export function GuestSignalPreview({ secondaryLabel, onSecondary }: GuestSignalPreviewProps) {
  const { colors, typography: typo } = useTheme();
  const copy = guestPromptCopy.signals;
  const cards = guestPreviewCards(PREVIEW_COUNT);

  const handleLogin = useCallback(() => {
    router.push(SIGN_IN_ROUTE);
  }, []);

  return (
    <View style={styles.container}>
      <View style={[styles.screenIcon, { backgroundColor: colors.primaryLight }]}>
        <Feather name={copy.icon} size={28} color={colors.primary} />
      </View>
      <Text style={[typo.h3, styles.title, { color: colors.text }]}>{copy.title}</Text>
      {copy.description ? (
        <Text style={[typo.caption, styles.description, { color: colors.textSecondary }]}>
          {copy.description}
        </Text>
      ) : null}

      {/* read-only 미리보기 카드(블러+잠금) — 신호 가치 '구조' 맛보기. */}
      <View
        style={styles.preview}
        accessibilityRole="image"
        accessibilityLabel="잠긴 신호 미리보기 예시 — 로그인하면 실제 매수·매도 신호를 볼 수 있어요"
      >
        {cards.map((card) => (
          <LockedPreviewCard key={card.maskedName} card={card} />
        ))}
      </View>

      {copy.benefits && copy.benefits.length > 0 ? (
        <View style={styles.benefits}>
          {copy.benefits.map((b) => (
            <View key={b} style={styles.benefitRow}>
              <Feather name="check" size={16} color={colors.primary} />
              <Text style={[typo.caption, styles.flex1, { color: colors.textSecondary }]}>{b}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Button
        mode="contained"
        onPress={handleLogin}
        style={styles.cta}
        contentStyle={styles.ctaContent}
        accessibilityLabel={`${copy.ctaLabel ?? '로그인'} — ${copy.title}`}
      >
        {copy.ctaLabel ?? '로그인'}
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
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
  },
  screenIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  flex1: {
    flex: 1,
  },
  title: {
    marginTop: spacing.md,
    textAlign: 'center',
  },
  description: {
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  preview: {
    alignSelf: 'stretch',
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
    overflow: 'hidden',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  gradeChip: {
    height: 26,
    minWidth: 56,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  gaugeTrack: {
    height: 10,
    borderRadius: radius.full,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  gaugeFill: {
    height: '100%',
    borderRadius: radius.full,
  },
  maskBar: {
    borderRadius: radius.sm,
  },
  maskBarChip: {
    width: 36,
    height: 8,
    opacity: 0.5,
  },
  maskBarLine: {
    height: 8,
    width: '60%',
    marginTop: spacing.md,
  },
  exampleBadge: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
  },
  lockBadge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lockPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
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
  cta: {
    marginTop: spacing.xl,
    alignSelf: 'stretch',
  },
  ctaContent: {
    paddingVertical: spacing.xs,
  },
  secondary: {
    marginTop: spacing.sm,
  },
});
