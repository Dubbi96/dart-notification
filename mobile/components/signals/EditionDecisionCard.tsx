import React, { useCallback, useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useTheme } from '@theme';
import { palette } from '@theme/colors';
import { radius, sizing, spacing } from '@theme/spacing';
import { useReducedMotion } from '@hooks/useReducedMotion';
import { getEventTypeLabel } from '@utils/disclosureType';

import type { TradingSignal } from '@app-types/signal.types';
import type { DeviceSignalDecision } from '@utils/deviceRuleDecision';

interface EditionDecisionCardProps {
  signal: TradingSignal;
  decision: DeviceSignalDecision;
  rank: number;
  historical?: boolean;
  onPress?: (signal: TradingSignal) => void;
}

function formatKrw(value: number): string {
  return `${Math.round(value).toLocaleString('ko-KR')}원`;
}

function EditionDecisionCardBase({
  signal,
  decision,
  rank,
  historical = false,
  onPress,
}: EditionDecisionCardProps) {
  const { colors, typography: typo, isDark } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [focused, setFocused] = useState(false);
  const [sourceFocused, setSourceFocused] = useState(false);
  const reducedMotion = useReducedMotion();
  const [detailOpacity] = useState(() => new Animated.Value(1));
  const danger = isDark ? colors.error : palette.red600;
  const accent = decision.tone === 'RISK' ? danger : colors.primaryDark;
  const plan = decision.pricePlan;
  const handlePress = useCallback(() => onPress?.(signal), [onPress, signal]);

  useEffect(() => {
    if (!expanded || reducedMotion) {
      detailOpacity.setValue(1);
      return;
    }
    detailOpacity.setValue(0);
    const animation = Animated.timing(detailOpacity, {
      toValue: 1,
      duration: 160,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [detailOpacity, expanded, reducedMotion]);

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View
        accessible
        accessibilityLabel={`${rank}순위 ${signal.corpName}. ${getEventTypeLabel(signal.eventType ?? 'OTHER')}`}
        style={styles.headerRow}
      >
        <Text style={[typo.captionMedium, styles.rank, { color: colors.textSecondary }]}>
          {rank}
        </Text>
        <View style={styles.titleWrap}>
          <Text style={[typo.h3, { color: colors.text }]}>{signal.corpName}</Text>
          <Text style={[typo.caption, { color: colors.textSecondary }]}>
            {getEventTypeLabel(signal.eventType ?? 'OTHER')}
          </Text>
        </View>
      </View>

      <Text style={[typo.bodyMedium, styles.verdict, { color: accent }]}>
        {historical ? '당시 ' : ''}
        {decision.verdict}
      </Text>

      {plan ? (
        <View style={[styles.planBox, { backgroundColor: colors.surfaceSecondary }]}>
          <Text style={[typo.caption, { color: colors.textSecondary }]}>모의 진입 구간</Text>
          <View
            accessible
            accessibilityLabel={`모의 진입 구간: 약 ${Math.round(plan.entryLow).toLocaleString('ko-KR')} ~ ${formatKrw(plan.entryHigh)}`}
            style={styles.planRange}
          >
            <Text style={[typo.h3, styles.price, { color: colors.text }]}>
              약 {formatKrw(plan.entryLow)}
            </Text>
            <Text style={[typo.h3, styles.price, { color: colors.text }]}>
              ~ {formatKrw(plan.entryHigh)}
            </Text>
          </View>
          <Text style={[typo.captionMedium, styles.stop, { color: danger }]}>
            손절 조건: 체결가 대비 {plan.stopLossPct}%
          </Text>
          <Text style={[typo.caption, { color: colors.textSecondary }]}>
            참고 약 {formatKrw(plan.stopPrice)}
          </Text>
          <Text style={[typo.caption, styles.source, { color: colors.textSecondary }]}>
            {plan.referenceTradeDate} 종가 기준 · 실시간 시세 아님
          </Text>
        </View>
      ) : (
        <Text style={[typo.body, styles.condition, { color: colors.text }]}>
          {decision.primaryCondition}
        </Text>
      )}

      <View style={styles.invalidation}>
        <Feather name="shield" size={sizing.icon.sm} color={danger} />
        <Text style={[typo.caption, styles.invalidationCopy, { color: colors.textSecondary }]}>
          <Text style={{ color: danger, fontWeight: '600' }}>중단 기준 </Text>
          {decision.invalidation}
        </Text>
      </View>

      <Pressable
        onPress={() => setExpanded((value) => !value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        accessibilityRole="button"
        accessibilityLabel={expanded ? '판단 근거 접기' : '판단 근거와 목표가 펼치기'}
        accessibilityState={{ expanded }}
        accessibilityHint="펼쳐도 주문은 실행되지 않습니다"
        style={({ pressed }) => [
          styles.disclosure,
          {
            borderColor: focused ? colors.primaryDark : colors.borderLight,
            backgroundColor: pressed ? colors.primaryLight : 'transparent',
          },
        ]}
      >
        <Text style={[typo.captionMedium, styles.actionLabel, { color: colors.primaryDark }]}>
          {expanded ? '판단 근거 접기' : '판단 근거와 목표가'}
        </Text>
        <Feather
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={sizing.icon.sm}
          color={colors.primaryDark}
        />
      </Pressable>

      {expanded ? (
        <Animated.View
          testID="decision-details"
          style={[styles.details, { opacity: detailOpacity }]}
        >
          <Text style={[typo.body, { color: colors.text }]}>{decision.rationale}</Text>
          {plan ? (
            <View style={styles.planDetails}>
              <Text style={[typo.caption, { color: colors.textSecondary }]}>
                모의 목표: 체결가 대비 +{plan.takeProfitPct}%에서 {plan.partialExitPct}% 부분익절
              </Text>
              <Text style={[typo.caption, { color: colors.textSecondary }]}>
                참고 목표 약 {formatKrw(plan.takeProfitPrice)}
              </Text>
              <Text style={[typo.caption, { color: colors.textSecondary }]}>
                최대 {plan.maxHoldDays}거래일 보유 · 기준 종가 {formatKrw(plan.referencePrice)}
              </Text>
              <Text style={[typo.caption, { color: colors.textSecondary }]}>
                참고 가격은 종가에서 반올림한 값입니다. 실제 주문·체결 가격이나 주문 가능한 호가를
                뜻하지 않습니다.
              </Text>
            </View>
          ) : null}
          <Text style={[typo.caption, { color: colors.textSecondary }]}>
            공시 신호 점수 {signal.buyScore}점 · 수익 확률 아님
          </Text>
          <Text style={[typo.caption, { color: colors.textSecondary }]}>
            기기 계산 기록 {decision.receiptHash.slice(0, 8)} · Shadow
          </Text>
          {onPress ? (
            <Pressable
              onPress={handlePress}
              onFocus={() => setSourceFocused(true)}
              onBlur={() => setSourceFocused(false)}
              accessibilityRole="button"
              accessibilityLabel="공시 원문과 분석 상세 보기"
              style={({ pressed }) => [
                styles.sourceLink,
                {
                  backgroundColor: pressed ? colors.primaryLight : colors.surfaceSecondary,
                  borderColor: sourceFocused ? colors.primaryDark : 'transparent',
                },
              ]}
            >
              <Text style={[typo.captionMedium, styles.actionLabel, { color: colors.primaryDark }]}>
                공시 원문과 분석 상세
              </Text>
              <Feather name="arrow-up-right" size={sizing.icon.sm} color={colors.primaryDark} />
            </Pressable>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  );
}

export const EditionDecisionCard = React.memo(EditionDecisionCardBase);

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.base },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  rank: { minWidth: 22, marginTop: spacing.xs },
  titleWrap: { flex: 1, minWidth: 0, gap: spacing.xs },
  verdict: { marginTop: spacing.base, fontWeight: '700' },
  planBox: { marginTop: spacing.md, padding: spacing.md, borderRadius: radius.md },
  planRange: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  price: { maxWidth: '100%' },
  stop: { marginTop: spacing.sm },
  source: { marginTop: spacing.sm },
  condition: { marginTop: spacing.sm },
  invalidation: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  invalidationCopy: { flex: 1, minWidth: 0 },
  actionLabel: { flex: 1, minWidth: 0 },
  disclosure: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  details: { gap: spacing.md, paddingTop: spacing.base },
  planDetails: { gap: spacing.sm },
  sourceLink: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
  },
});
