import React, { useCallback } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useTheme, type ThemeColors } from '@theme';
import { radius, sizing, spacing } from '@theme/spacing';
import { getEventTypeLabel } from '@utils/disclosureType';

import type { TradingSignal } from '@app-types/signal.types';
import type { DevicePlanTone, DeviceSignalDecision } from '@utils/deviceRuleDecision';

interface EditionDecisionCardProps {
  signal: TradingSignal;
  decision: DeviceSignalDecision;
  rank: number;
  historical?: boolean;
  onPress?: (signal: TradingSignal) => void;
}

function toneColor(tone: DevicePlanTone, colors: ThemeColors): string {
  if (tone === 'READY') return colors.success;
  if (tone === 'RISK') return colors.error;
  return colors.warning;
}

function formatKrw(value: number): string {
  return `약 ${Math.round(value).toLocaleString('ko-KR')}원`;
}

function EditionDecisionCardBase({
  signal,
  decision,
  rank,
  historical = false,
  onPress,
}: EditionDecisionCardProps) {
  const { colors, typography: typo } = useTheme();
  const accent = toneColor(decision.tone, colors);
  const handlePress = useCallback(() => onPress?.(signal), [onPress, signal]);

  return (
    <TouchableOpacity
      activeOpacity={0.82}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={`${rank}순위 ${signal.corpName}. ${decision.verdict}. ${decision.rationale}`}
      accessibilityHint="공시와 점수 근거 자세히 보기"
    >
      <View
        importantForAccessibility="no-hide-descendants"
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <View style={styles.headerRow}>
          <View style={[styles.rankBox, { backgroundColor: colors.surfaceSecondary }]}>
            <Text style={[typo.small, styles.bold, { color: colors.textSecondary }]}>{rank}</Text>
          </View>
          <View style={styles.titleWrap}>
            <Text
              style={[typo.bodyMedium, styles.bold, { color: colors.text }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {signal.corpName}
            </Text>
            <Text style={[typo.small, { color: colors.textSecondary }]} numberOfLines={1}>
              {getEventTypeLabel(signal.eventType ?? 'OTHER')} · {signal.buyScore}점
            </Text>
          </View>
        </View>

        <View style={[styles.verdict, { backgroundColor: colors.surfaceSecondary }]}>
          <Feather name="navigation" size={sizing.icon.sm} color={accent} />
          <Text style={[typo.captionMedium, styles.verdictText, { color: accent }]}>
            {historical ? '당시 ' : ''}
            {decision.verdict}
          </Text>
        </View>

        <Text style={[typo.caption, styles.rationale, { color: colors.text }]} numberOfLines={2}>
          {decision.rationale}
        </Text>

        {decision.pricePlan ? (
          <View style={[styles.planBox, { backgroundColor: colors.surfaceSecondary }]}>
            <Text style={[typo.small, styles.sectionLabel, { color: colors.primary }]}>
              실행 가격 플랜
            </Text>
            <View style={styles.planGrid}>
              <PlanCell
                label="관심 진입 구간"
                value={`${formatKrw(decision.pricePlan.entryLow)} ~ ${formatKrw(decision.pricePlan.entryHigh)}`}
              />
              <PlanCell
                label={`${decision.pricePlan.partialExitPct}% 부분익절`}
                value={`${formatKrw(decision.pricePlan.takeProfitPrice)} (+${decision.pricePlan.takeProfitPct}%)`}
              />
              <PlanCell
                label="손절 기준"
                value={`${formatKrw(decision.pricePlan.stopPrice)} (${decision.pricePlan.stopLossPct}%)`}
              />
              <PlanCell label="최대 보유" value={`${decision.pricePlan.maxHoldDays}거래일`} />
            </View>
            <Text style={[typo.small, styles.source, { color: colors.textTertiary }]}>
              기준 {decision.pricePlan.referenceTradeDate} 종가{' '}
              {decision.pricePlan.referencePrice.toLocaleString('ko-KR')}원
            </Text>
          </View>
        ) : (
          <View style={[styles.waitBox, { backgroundColor: colors.surfaceSecondary }]}>
            <Feather name="pause-circle" size={sizing.icon.sm} color={accent} />
            <Text style={[typo.small, styles.waitText, { color: colors.textSecondary }]}>
              {decision.primaryCondition}
            </Text>
          </View>
        )}

        <View style={[styles.invalidation, { borderTopColor: colors.borderLight }]}>
          <Feather name="shield" size={sizing.icon.sm} color={colors.error} />
          <View style={styles.invalidationCopy}>
            <Text style={[typo.small, styles.bold, { color: colors.error }]}>계획 중단 기준</Text>
            <Text style={[typo.small, { color: colors.textSecondary }]}>
              {decision.invalidation}
            </Text>
          </View>
        </View>

        <View style={styles.footerRow}>
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            기기 Rule receipt {decision.receiptHash.slice(0, 8)}
          </Text>
          <View style={styles.detailLink}>
            <Text style={[typo.small, styles.bold, { color: colors.primary }]}>근거 보기</Text>
            <Feather name="chevron-right" size={sizing.icon.sm} color={colors.primary} />
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );

  function PlanCell({ label, value }: { label: string; value: string }) {
    return (
      <View style={styles.planCell}>
        <Text style={[typo.small, { color: colors.textTertiary }]}>{label}</Text>
        <Text style={[typo.small, styles.planValue, { color: colors.text }]}>{value}</Text>
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rankBox: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
  },
  bold: {
    fontWeight: '700',
  },
  verdict: {
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
    flexShrink: 1,
  },
  rationale: {
    marginTop: spacing.sm,
  },
  planBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  sectionLabel: {
    fontWeight: '700',
  },
  planGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  planCell: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 128,
  },
  planValue: {
    fontWeight: '700',
    marginTop: spacing.xs,
  },
  source: {
    marginTop: spacing.sm,
  },
  waitBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  waitText: {
    flex: 1,
  },
  invalidation: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
  },
  invalidationCopy: {
    flex: 1,
    minWidth: 0,
  },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  detailLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 44,
  },
});
