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
  const displayConditions =
    plan.unmetConditions.length > 0 ? plan.unmetConditions : plan.metConditions;

  return (
    <TouchableOpacity
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
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {signal.corpName}
            </Text>
            <Text style={[typo.small, { color: colors.textSecondary }]}>
              {plan.eventLabel} · {gradeLabel(signal.grade)} {signal.buyScore}점
            </Text>
          </View>
          <View style={[styles.verdictBadge, { backgroundColor: colors.surfaceSecondary }]}>
            <Text
              style={[typo.small, styles.verdictText, { color: accent }]}
              maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
            >
              {plan.verdict}
            </Text>
          </View>
        </View>

        <SectionLabel icon="message-circle" label="한 줄 판단" color={accent} />
        <Text style={[typo.caption, styles.rationale, { color: colors.text }]}>
          {plan.rationale}
        </Text>

        <View style={[styles.planBox, { backgroundColor: colors.surfaceSecondary }]}>
          <SectionLabel icon="check-square" label="진입 전 확인" color={colors.primary} />
          {displayConditions.length > 0 ? (
            displayConditions
              .slice(0, 2)
              .map((condition) => (
                <GuideRow
                  key={condition.id}
                  icon={condition.met ? 'check-circle' : 'circle'}
                  text={condition.label}
                  color={condition.met ? colors.success : colors.warning}
                />
              ))
          ) : (
            <GuideRow icon="search" text={plan.entryGuide} color={colors.textSecondary} />
          )}

          <View style={[styles.rule, { backgroundColor: colors.borderLight }]} />
          <SectionLabel icon="slash" label="계획 중단 기준" color={colors.error} />
          <GuideRow icon="alert-circle" text={plan.invalidationGuide} color={colors.error} />
        </View>

        {plan.hasShortMomentumScenario ? (
          <View style={[styles.scenario, { borderColor: colors.borderLight }]}>
            <View style={styles.scenarioHeader}>
              <View style={styles.scenarioTitleRow}>
                <Feather name="activity" size={sizing.icon.sm} color={colors.primary} />
                <Text style={[typo.captionMedium, styles.scenarioTitle, { color: colors.text }]}>
                  {historical ? '당시 ' : ''}단기 참고 시나리오
                </Text>
              </View>
              <Text style={[typo.small, { color: colors.textTertiary }]}>조건 충족 시에만</Text>
            </View>
            <Text style={[typo.small, styles.scenarioNote, { color: colors.textSecondary }]}>
              실제 매수가는 아직 정해지지 않았어요. 다음 진입 가능일 체결가를 기준으로 계산합니다.
            </Text>
            <View style={styles.scenarioGrid}>
              <ScenarioCell label="진입" value="진입 가능일 시가" />
              <ScenarioCell
                label="청산 참고"
                value={`체결가 +${SHORT_MOMENTUM_RULE.takeProfitPct}%`}
              />
              <ScenarioCell label="중단" value={`체결가 ${SHORT_MOMENTUM_RULE.stopLossPct}%`} />
              <ScenarioCell label="기한" value={`${SHORT_MOMENTUM_RULE.maxHoldDays}거래일`} />
            </View>
          </View>
        ) : null}

        <View style={styles.detailRow}>
          <Text style={[typo.small, styles.detailText, { color: colors.primary }]}>
            공시·점수 근거 자세히 보기
          </Text>
          <Feather name="chevron-right" size={sizing.icon.sm} color={colors.primary} />
        </View>
      </View>
    </TouchableOpacity>
  );

  function SectionLabel({
    icon,
    label,
    color,
  }: {
    icon: keyof typeof Feather.glyphMap;
    label: string;
    color: string;
  }) {
    return (
      <View style={styles.sectionLabel}>
        <Feather name={icon} size={14} color={color} />
        <Text style={[typo.small, styles.sectionLabelText, { color }]}>{label}</Text>
      </View>
    );
  }

  function GuideRow({
    icon,
    text,
    color,
  }: {
    icon: keyof typeof Feather.glyphMap;
    text: string;
    color: string;
  }) {
    return (
      <View style={styles.guideRow}>
        <Feather name={icon} size={14} color={color} />
        <Text style={[typo.small, styles.guideText, { color: colors.textSecondary }]}>{text}</Text>
      </View>
    );
  }

  function ScenarioCell({ label, value }: { label: string; value: string }) {
    return (
      <View style={[styles.scenarioCell, { backgroundColor: colors.surfaceSecondary }]}>
        <Text style={[typo.small, { color: colors.textTertiary }]}>{label}</Text>
        <Text
          style={[typo.small, styles.scenarioValue, { color: colors.text }]}
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
  verdictBadge: {
    maxWidth: '38%',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
  },
  verdictText: {
    fontWeight: '700',
    textAlign: 'center',
  },
  sectionLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  sectionLabelText: {
    fontWeight: '700',
  },
  rationale: {
    marginTop: spacing.xs,
  },
  planBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
  },
  guideRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  guideText: {
    flex: 1,
  },
  rule: {
    height: 1,
    marginTop: spacing.md,
  },
  scenario: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
  },
  scenarioHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  scenarioTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 1,
  },
  scenarioTitle: {
    fontWeight: '700',
  },
  scenarioNote: {
    marginTop: spacing.xs,
  },
  scenarioGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  scenarioCell: {
    width: '48%',
    flexGrow: 1,
    minWidth: 120,
    padding: spacing.sm,
    borderRadius: radius.sm,
  },
  scenarioValue: {
    fontWeight: '700',
    marginTop: 2,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    minHeight: 32,
  },
  detailText: {
    fontWeight: '700',
  },
});
