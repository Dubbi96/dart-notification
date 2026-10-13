import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { HelpButton } from '@components/common/HelpButton';

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
        <HelpButton
          title="종합 의견"
          sections={[
            {
              heading: '계산 기준',
              body: `${decision.unavailableCount === 0 ? `${decision.description}\n\n` : ''}기기에서 종가 기준으로 계산한 모의 계획입니다. 실시간 판단·실주문이 아닙니다.`,
            },
            {
              heading: '참고 가격',
              body: '참고 가격은 종가에서 반올림한 값입니다. 실제 주문·체결 가격이나 주문 가능한 호가를 뜻하지 않습니다.',
            },
          ]}
        />
      </View>
      <Text accessibilityRole="header" style={[typo.h2, styles.headline, { color: colors.text }]}>
        {decision.headline}
      </Text>
      {decision.unavailableCount > 0 ? (
        <Text style={[typo.body, styles.description, { color: colors.textSecondary }]}>
          {decision.description}
        </Text>
      ) : null}
      <View style={styles.mode}>
        <Feather name="smartphone" size={sizing.icon.sm} color={colors.primaryDark} />
        <Text style={[typo.caption, styles.modeText, { color: colors.primaryDark }]}>
          종가 기반 모의 계획 · 실주문 아님
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
  headline: { marginTop: spacing.xs },
  description: { marginTop: spacing.sm },
  mode: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.base,
  },
  modeText: { flex: 1, minWidth: 0 },
  counts: { marginTop: spacing.md },
});
