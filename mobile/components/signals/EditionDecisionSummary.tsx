import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
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
          <Feather name="compass" size={sizing.icon.md} color={accent} />
        </View>
        <Text style={[typo.small, styles.eyebrow, { color: accent }]}>{decision.eyebrow}</Text>
      </View>

      <Text style={[typo.h3, styles.headline, { color: colors.text }]}>{decision.headline}</Text>
      <Text style={[typo.caption, styles.description, { color: colors.textSecondary }]}>
        {decision.description}
      </Text>

      <View style={[styles.stats, { borderColor: colors.borderLight }]}>
        <Stat value={signals.length} label="전체 판단" />
        <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />
        <Stat value={decision.readyCount} label="조건 준비" />
        <View style={[styles.divider, { backgroundColor: colors.borderLight }]} />
        <Stat value={decision.riskCount} label="리스크 있음" />
      </View>

      <View style={[styles.priority, { backgroundColor: colors.surfaceSecondary }]}>
        <Feather name="arrow-right-circle" size={sizing.icon.sm} color={accent} />
        <View style={styles.priorityCopy}>
          <Text style={[typo.small, { color: colors.textSecondary }]}>먼저 볼 판단</Text>
          <Text style={[typo.captionMedium, { color: colors.text }]}>{decision.topPriority}</Text>
        </View>
      </View>
    </View>
  );

  function Stat({ value, label }: { value: number; label: string }) {
    return (
      <View style={styles.stat}>
        <Text style={[typo.h3, { color: colors.text }]}>{value}</Text>
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
  eyebrowRow: {
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
  eyebrow: {
    fontWeight: '700',
  },
  headline: {
    marginTop: spacing.md,
  },
  description: {
    marginTop: spacing.xs,
  },
  stats: {
    flexDirection: 'row',
    alignItems: 'stretch',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    marginTop: spacing.base,
    paddingVertical: spacing.md,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  divider: {
    width: 1,
  },
  priority: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  priorityCopy: {
    flex: 1,
  },
});
