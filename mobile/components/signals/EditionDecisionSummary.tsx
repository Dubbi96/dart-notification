import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius, sizing } from '@theme/spacing';
import { buildEditionDecision } from '@utils/editionDecision';

import type { TradingSignal } from '@app-types/signal.types';

import type { ThemeColors } from '@theme';

interface EditionDecisionSummaryProps {
  signals: TradingSignal[];
  historical?: boolean;
}

function toneColor(tone: ReturnType<typeof buildEditionDecision>['tone'], colors: ThemeColors) {
  if (tone === 'ready') return colors.success;
  if (tone === 'mixed') return colors.primary;
  return colors.warning;
}

function EditionDecisionSummaryBase({ signals, historical = false }: EditionDecisionSummaryProps) {
  const { colors, typography: typo } = useTheme();
  const decision = useMemo(() => buildEditionDecision(signals, historical), [signals, historical]);
  const accent = toneColor(decision.tone, colors);

  if (signals.length === 0) return null;

  return (
    <View
      testID="edition-decision-summary"
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      accessibilityRole="summary"
      accessibilityLabel={`${decision.eyebrow}. ${decision.headline}. ${decision.description} ${decision.topPriority}`}
    >
      <View style={styles.eyebrowRow}>
        <View style={[styles.iconBox, { backgroundColor: colors.surfaceSecondary }]}>
          <Feather name="compass" size={sizing.icon.sm} color={accent} />
        </View>
        <Text style={[typo.small, styles.eyebrow, { color: accent }]}>{decision.eyebrow}</Text>
      </View>

      <Text
        style={[typo.h3, styles.headline, { color: colors.text }]}
        numberOfLines={2}
        ellipsizeMode="tail"
      >
        {decision.headline}
      </Text>
      <Text
        style={[typo.caption, styles.description, { color: colors.textSecondary }]}
        numberOfLines={2}
        ellipsizeMode="tail"
      >
        {decision.description}
      </Text>

      <View style={styles.metrics}>
        <Metric label="전체" value={signals.length} color={colors.textSecondary} />
        <Metric label="조건부 검토" value={decision.readyCount} color={accent} />
        {decision.checkCount > 0 ? (
          <Metric label="대기" value={decision.checkCount} color={colors.warning} />
        ) : null}
        {decision.riskCount > 0 ? (
          <Metric label="리스크" value={decision.riskCount} color={colors.error} />
        ) : null}
      </View>

      <View style={[styles.priority, { backgroundColor: colors.surfaceSecondary }]}>
        <Feather name="arrow-right-circle" size={sizing.icon.sm} color={accent} />
        <View style={styles.priorityCopy}>
          <Text style={[typo.small, { color: colors.textSecondary }]}>먼저 볼 판단</Text>
          <Text
            style={[typo.captionMedium, { color: colors.text }]}
            numberOfLines={3}
            ellipsizeMode="tail"
          >
            {decision.topPriority}
          </Text>
        </View>
      </View>
    </View>
  );

  function Metric({ value, label, color }: { value: number; label: string; color: string }) {
    return (
      <View style={[styles.metric, { borderColor: colors.borderLight }]}>
        <Text
          style={[typo.small, styles.metricText, { color }]}
          maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
        >
          {label} {value}
        </Text>
      </View>
    );
  }
}

export const EditionDecisionSummary = React.memo(EditionDecisionSummaryBase);

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.base,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  iconBox: {
    width: 32,
    height: 32,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eyebrow: {
    fontWeight: '700',
  },
  headline: {
    marginTop: spacing.sm,
  },
  description: {
    marginTop: spacing.xs,
  },
  metrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  metric: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  metricText: {
    fontWeight: '700',
  },
  priority: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
  },
  priorityCopy: {
    flex: 1,
  },
});
