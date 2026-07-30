import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius, sizing } from '@theme/spacing';
import {
  buildEditionSignalPlan,
  SHORT_MOMENTUM_RULE,
  type SignalPlanTone,
} from '@utils/editionDecision';
import { gradeLabel } from '@utils/signalDisplay';

import type { TradingSignal } from '@app-types/signal.types';

import type { ThemeColors } from '@theme';

interface EditionDecisionCardProps {
  signal: TradingSignal;
  rank: number;
  historical?: boolean;
  onPress?: (signal: TradingSignal) => void;
}

function toneColor(tone: SignalPlanTone, colors: ThemeColors) {
  if (tone === 'ready') return colors.success;
  if (tone === 'risk') return colors.error;
  if (tone === 'check') return colors.warning;
  return colors.textSecondary;
}

function toneIcon(tone: SignalPlanTone): keyof typeof Feather.glyphMap {
  if (tone === 'ready') return 'check-circle';
  if (tone === 'risk') return 'alert-triangle';
  if (tone === 'check') return 'clock';
  return 'search';
}

function pausedGuide(tone: SignalPlanTone) {
  if (tone === 'risk') return '리스크가 해소되기 전에는 진입하지 않아요.';
  if (tone === 'check') return '필수 조건이 충족되기 전에는 진입하지 않아요.';
  return '상세 근거를 확인한 뒤 판단하세요.';
}

function EditionDecisionCardBase({
  signal,
  rank,
  historical = false,
  onPress,
}: EditionDecisionCardProps) {
  const { colors, typography: typo } = useTheme();
  const plan = useMemo(() => buildEditionSignalPlan(signal), [signal]);
  const accent = toneColor(plan.tone, colors);
  const handlePress = useCallback(() => onPress?.(signal), [onPress, signal]);

  return (
    <TouchableOpacity
      testID={`edition-decision-card-${signal.id}`}
      activeOpacity={0.8}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${rank}순위 ${signal.corpName}, ${plan.verdict}, ${plan.rationale}`}
      accessibilityHint="판단 상세 근거 보기"
    >
      <View
        importantForAccessibility="no-hide-descendants"
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <View style={styles.header}>
          <View style={[styles.rankBox, { backgroundColor: colors.surfaceSecondary }]}>
            <Text style={[typo.small, styles.rankText, { color: colors.textSecondary }]}>
              {rank}
            </Text>
          </View>
          <View style={styles.titleWrap}>
            <Text
              style={[typo.bodyMedium, styles.corpName, { color: colors.text }]}
              numberOfLines={2}
              ellipsizeMode="tail"
            >
              {signal.corpName}
            </Text>
            <View style={styles.metaRow}>
              <Text
                style={[typo.small, styles.metaText, { color: colors.textSecondary }]}
                numberOfLines={1}
                ellipsizeMode="tail"
                maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
              >
                {plan.eventLabel} · {gradeLabel(signal.grade)}
              </Text>
              <Text
                style={[typo.small, styles.metaScore, { color: colors.textSecondary }]}
                maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
              >
                · {signal.buyScore}점
              </Text>
            </View>
          </View>
          <Feather name="chevron-right" size={sizing.icon.sm} color={colors.textTertiary} />
        </View>

        <View style={[styles.verdictRow, { backgroundColor: colors.surfaceSecondary }]}>
          <Feather name={toneIcon(plan.tone)} size={sizing.icon.sm} color={accent} />
          <Text
            style={[typo.small, styles.verdictText, { color: accent }]}
            maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
          >
            {plan.verdict}
          </Text>
        </View>

        <Text
          style={[typo.caption, styles.rationale, { color: colors.text }]}
          numberOfLines={2}
          ellipsizeMode="tail"
        >
          {plan.rationale}
        </Text>

        <View style={[styles.actionBox, { backgroundColor: colors.surfaceSecondary }]}>
          <View style={styles.actionLabelRow}>
            <Feather name="crosshair" size={14} color={accent} />
            <Text style={[typo.small, styles.actionLabel, { color: accent }]}>
              {plan.hasShortMomentumScenario ? '지금 확인할 것' : '먼저 확인할 것'}
            </Text>
          </View>
          <Text
            style={[typo.captionMedium, styles.entryGuide, { color: colors.text }]}
            numberOfLines={2}
            ellipsizeMode="tail"
          >
            {plan.entryGuide}
          </Text>

          {plan.hasShortMomentumScenario ? (
            <View style={[styles.plan, { borderColor: colors.borderLight }]}>
              <View style={styles.planTitleRow}>
                <Text style={[typo.small, styles.planTitle, { color: colors.textSecondary }]}>
                  {historical ? '당시 ' : ''}조건 유지 시 단기 기준
                </Text>
                <Text style={[typo.small, { color: colors.textTertiary }]}>실제 체결가 기준</Text>
              </View>
              <View style={styles.planMetrics}>
                <PlanMetric label="청산 참고" value={`+${SHORT_MOMENTUM_RULE.takeProfitPct}%`} />
                <PlanMetric label="중단" value={`${SHORT_MOMENTUM_RULE.stopLossPct}%`} />
                <PlanMetric label="최대" value={`${SHORT_MOMENTUM_RULE.maxHoldDays}거래일`} />
              </View>
              <Text style={[typo.small, styles.planNote, { color: colors.textSecondary }]}>
                필수 조건이 깨지면 이 기준을 적용하지 않아요.
              </Text>
            </View>
          ) : (
            <View style={styles.pauseRow}>
              <Feather name="pause-circle" size={14} color={colors.textSecondary} />
              <Text style={[typo.small, styles.pauseText, { color: colors.textSecondary }]}>
                {pausedGuide(plan.tone)}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.detailRow}>
          <Text style={[typo.small, styles.detailText, { color: colors.primary }]}>
            공시·점수 근거 보기
          </Text>
          <Feather name="arrow-right" size={sizing.icon.sm} color={colors.primary} />
        </View>
      </View>
    </TouchableOpacity>
  );

  function PlanMetric({ label, value }: { label: string; value: string }) {
    return (
      <View style={[styles.planMetric, { borderColor: colors.borderLight }]}>
        <Text
          style={[typo.small, { color: colors.textTertiary }]}
          numberOfLines={1}
          ellipsizeMode="tail"
          maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
        >
          {label}
        </Text>
        <Text
          style={[typo.small, styles.planValue, { color: colors.text }]}
          maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
        >
          {value}
        </Text>
      </View>
    );
  }
}

export const EditionDecisionCard = React.memo(EditionDecisionCardBase);

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  rankBox: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankText: {
    fontWeight: '700',
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
  },
  corpName: {
    fontWeight: '700',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 2,
  },
  metaText: {
    flexShrink: 1,
    minWidth: 0,
  },
  metaScore: {
    flexShrink: 0,
  },
  verdictRow: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  verdictText: {
    fontWeight: '700',
  },
  rationale: {
    marginTop: spacing.sm,
  },
  actionBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  actionLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  actionLabel: {
    fontWeight: '700',
  },
  entryGuide: {
    marginTop: spacing.xs,
    fontWeight: '600',
  },
  pauseRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  pauseText: {
    flex: 1,
  },
  plan: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
  },
  planTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  planTitle: {
    fontWeight: '700',
  },
  planMetrics: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  planMetric: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  planValue: {
    fontWeight: '700',
  },
  planNote: {
    marginTop: spacing.sm,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
    minHeight: 32,
  },
  detailText: {
    fontWeight: '700',
  },
});
