import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '@theme';
import { radius, sizing, spacing } from '@theme/spacing';

import type { DeviceEditionDecision } from '@utils/deviceRuleDecision';

interface EditionDecisionSummaryProps {
  decision: DeviceEditionDecision;
  historical?: boolean;
}

function EditionDecisionSummaryBase({ decision, historical = false }: EditionDecisionSummaryProps) {
  const { colors, typography: typo } = useTheme();
  const accent = decision.readyCount > 0 ? colors.primary : colors.warning;
  const firstDecision = decision.decisions[0];

  return (
    <View
      testID="edition-decision-summary"
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      accessibilityRole="summary"
      accessibilityLabel={`${historical ? '당시' : '오늘'}의 종합 의견. ${decision.headline}. ${decision.description}`}
    >
      <View style={styles.labelRow}>
        <View style={[styles.iconBox, { backgroundColor: colors.primaryLight }]}>
          <Feather name="compass" size={sizing.icon.md} color={accent} />
        </View>
        <View style={styles.labelCopy}>
          <Text style={[typo.small, styles.eyebrow, { color: accent }]}>종가 후 운영 브리핑</Text>
          <Text style={[typo.small, { color: colors.textSecondary }]}>
            기기 계산 · Shadow · 실주문 아님
          </Text>
        </View>
      </View>

      <Text style={[typo.h3, styles.headline, { color: colors.text }]}>
        {historical ? '당시 기준 · ' : ''}
        {decision.headline}
      </Text>
      <Text style={[typo.caption, styles.description, { color: colors.textSecondary }]}>
        {decision.description}
      </Text>

      <View style={styles.countRow}>
        <CountPill label="계획" value={decision.readyCount} color={colors.success} />
        <CountPill label="조건 확인" value={decision.checkCount} color={colors.warning} />
        <CountPill
          label="대기"
          value={decision.riskCount + decision.unavailableCount}
          color={colors.error}
        />
      </View>
      {firstDecision ? (
        <Text style={[typo.small, styles.version, { color: colors.textTertiary }]} numberOfLines={2}>
          Strategy {firstDecision.evaluation.receipt.version.strategyVersionId} · 기준{' '}
          {firstDecision.calculatedAt.slice(0, 10)} · receipt{' '}
          {firstDecision.receiptHash.slice(0, 8)}
        </Text>
      ) : null}
    </View>
  );

  function CountPill({ label, value, color }: { label: string; value: number; color: string }) {
    return (
      <View style={[styles.countPill, { backgroundColor: colors.surfaceSecondary }]}>
        <Text style={[typo.captionMedium, { color }]}>{value}</Text>
        <Text style={[typo.small, { color: colors.textSecondary }]}>{label}</Text>
      </View>
    );
  }
}

export const EditionDecisionSummary = React.memo(EditionDecisionSummaryBase);

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.lg,
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  labelCopy: {
    flex: 1,
    minWidth: 0,
  },
  eyebrow: {
    fontWeight: '700',
  },
  headline: {
    marginTop: spacing.md,
  },
  description: {
    marginTop: spacing.xs,
  },
  countRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.base,
  },
  countPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  version: {
    marginTop: spacing.md,
  },
});
