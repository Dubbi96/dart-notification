import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Surface, Chip } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { AiReferenceLabel } from '@components/common/AiReferenceLabel';
import { ScoreGauge } from '@components/common/ScoreGauge';
import { gradeColor, gradeLabel } from '@utils/signalDisplay';
import { getEventTypeLabel } from '@utils/disclosureType';

import type { TradingSignal, EntryCondition } from '@app-types/signal.types';

// 매수 신호 카드(기획 §3 SCR-SIGNALS). Surface(elevation=2) 컨테이너.
// 색상 단독 의미 전달 금지 — 색상 + 텍스트 레이블 + 아이콘 병행.

interface BuyScoreCardProps {
  signal: TradingSignal;
  onPress?: (signal: TradingSignal) => void;
}

function EntryConditionRow({ condition }: { condition: EntryCondition }) {
  const { colors, typography: typo } = useTheme();
  // 미충족·비필수 조건도 '읽어야 하는' 진입 정보 → textSecondary(다크 AA 6.1:1, P0-A §2)
  const metColor = condition.met
    ? colors.success
    : condition.required
      ? colors.error
      : colors.textSecondary;
  // 색맹 대응(§8-2): 필수 미충족은 형태가 다른 alert-circle로 구분(색 단독 의존 제거)
  const iconName = condition.met
    ? 'check-circle'
    : condition.required
      ? 'alert-circle'
      : 'circle';
  // 상태어 합성(§8-2): 스크린리더가 색 대신 '필수 미충족' 등 텍스트로 읽도록
  const conditionStatus = condition.met
    ? '충족'
    : condition.required
      ? '필수 미충족'
      : '미충족';
  return (
    <View
      style={styles.conditionRow}
      accessibilityLabel={`${condition.required ? '필수 진입 조건' : '선택 진입 조건'} ${condition.label}: ${conditionStatus}`}
    >
      <Feather name={iconName} size={14} color={metColor} />
      <Text style={[typo.small, { color: colors.textSecondary, flex: 1 }]}>
        {condition.required ? '필수 ' : ''}
        {condition.label}
      </Text>
    </View>
  );
}

export function BuyScoreCard({ signal, onPress }: BuyScoreCardProps) {
  const { colors, typography: typo } = useTheme();
  const isBlocked = signal.grade === 'BLOCKED';
  const handlePress = useCallback(() => onPress?.(signal), [onPress, signal]);

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={handlePress}
      accessibilityRole="button"
      // 카드 그룹핑(§8-1): 카드를 단일 단위로 읽고, 내부 요소 중복 읽기를 막는다
      accessibilityLabel={`${signal.corpName} 매수 신호, Buy Score ${signal.buyScore}, ${gradeLabel(
        signal.grade,
      )}`}
      accessibilityActions={[{ name: 'activate', label: '신호 상세 보기' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'activate') handlePress();
      }}
    >
      <Surface
        elevation={2}
        importantForAccessibility="no-hide-descendants"
        style={[
          styles.card,
          {
            backgroundColor: isBlocked ? colors.surfaceSecondary : colors.surface,
            borderColor: colors.border,
          },
        ]}
      >
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            {signal.eventType ? (
              <Chip compact mode="flat" style={[styles.eventChip, { backgroundColor: colors.surfaceSecondary }]}
                textStyle={[typo.small, { color: colors.textSecondary }]}>
                {getEventTypeLabel(signal.eventType)}
              </Chip>
            ) : null}
            <Text style={[typo.bodyMedium, { color: colors.text }]} numberOfLines={1}>
              {signal.corpName}
            </Text>
          </View>
          <Chip
            compact
            mode="flat"
            style={[styles.gradeChip, { backgroundColor: colors.surfaceSecondary }]}
            textStyle={[typo.small, { color: gradeColor(signal.grade, colors), fontWeight: '700' }]}
          >
            {gradeLabel(signal.grade)}
          </Chip>
        </View>

        {signal.ticker ? (
          // ticker는 읽어야 할 종목 식별자 → textSecondary(다크 AA, P0-A §2). 이벤트는 평문 변환(P0-B)
          <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.xs }]}>
            {signal.ticker}
            {signal.eventType ? ` · ${getEventTypeLabel(signal.eventType)}` : ''}
          </Text>
        ) : null}

        {isBlocked ? (
          <View style={[styles.blockedBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Feather name="slash" size={14} color={colors.textTertiary} />
            <Text style={[typo.small, { color: colors.textTertiary, flex: 1 }]}>
              {signal.blockedReason ?? '조건 미충족으로 차단된 신호입니다.'}
            </Text>
          </View>
        ) : (
          <>
            <View style={styles.gaugeWrap}>
              <ScoreGauge
                score={signal.buyScore}
                kind="buy"
                statusText={gradeLabel(signal.grade)}
                accessibilityHidden
              />
            </View>

            {/* §9-5: Dynamic Type 1.5x에서 2줄 클립 방지 → 3줄로 완화 */}
            {signal.summary ? (
              <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.sm }]} numberOfLines={3}>
                {signal.summary}
              </Text>
            ) : null}

            {signal.entryConditions.length > 0 ? (
              <View style={styles.conditionList}>
                {signal.entryConditions.slice(0, 3).map((c) => (
                  <EntryConditionRow key={c.id} condition={c} />
                ))}
              </View>
            ) : null}

            {signal.riskFlags.length > 0 ? (
              <View style={styles.riskRow}>
                <Feather name="alert-triangle" size={13} color={colors.warning} />
                <Text style={[typo.small, { color: colors.textSecondary, flex: 1 }]} numberOfLines={1}>
                  {signal.riskFlags[0].label}
                </Text>
              </View>
            ) : null}

            <View style={styles.footerRow}>
              <AiReferenceLabel />
            </View>
          </>
        )}
      </Surface>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flex: 1,
  },
  eventChip: {
    height: 26,
  },
  gradeChip: {
    height: 26,
  },
  gaugeWrap: {
    marginTop: spacing.md,
  },
  conditionList: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  conditionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  riskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  blockedBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  footerRow: {
    marginTop: spacing.md,
  },
});
