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

  return (
    <View
      testID="edition-decision-summary"
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.labelRow}>
        <Feather name="compass" size={sizing.icon.md} color={colors.primaryDark} />
        <Text style={[typo.captionMedium, styles.labelText, { color: colors.primaryDark }]}>
          {historical ? '당시의' : '오늘의'} 종합 의견
        </Text>
      </View>
      <Text accessibilityRole="header" style={[typo.h2, styles.headline, { color: colors.text }]}>
        {decision.headline}
      </Text>
      <Text style={[typo.body, styles.description, { color: colors.textSecondary }]}>
        {decision.description}
      </Text>
      <View style={[styles.mode, { backgroundColor: colors.primaryLight }]}>
        <Feather name="smartphone" size={sizing.icon.sm} color={colors.primaryDark} />
        <Text style={[typo.caption, styles.modeText, { color: colors.primaryDark }]}>
          기기에서 종가 기준으로 계산한 모의 계획입니다. 실시간 판단·실주문이 아닙니다.
        </Text>
      </View>
      <Text style={[typo.caption, styles.counts, { color: colors.textSecondary }]}>
        계획 {decision.readyCount}개 · 조건 확인 {decision.checkCount}개 · 대기{' '}
        {decision.riskCount + decision.unavailableCount}개
      </Text>
    </View>
  );
}

export const EditionDecisionSummary = React.memo(EditionDecisionSummaryBase);

const styles = StyleSheet.create({
  card: { borderRadius: radius.xl, borderWidth: 1, padding: spacing.lg },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  labelText: { flex: 1, minWidth: 0 },
  headline: { marginTop: spacing.md },
  description: { marginTop: spacing.sm },
  mode: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.base,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  modeText: { flex: 1, minWidth: 0 },
  counts: { marginTop: spacing.md },
});
