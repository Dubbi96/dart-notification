import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Surface, Chip } from 'react-native-paper';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { SignalMiniGauge } from '@components/signals/SignalMiniGauge';
import { gradeColor, gradeLabel, scoreOneLiner } from '@utils/signalDisplay';
import { getEventTypeLabel } from '@utils/disclosureType';

import type { TradingSignal } from '@app-types/signal.types';

// 등급무관 탐색 카드(DAR-46 §1) — 종목명·이벤트유형 칩·점수 미니게이지·등급 칩·핵심 근거 1줄.
// 매수 카드(BuyScoreCard)와 달리 진입조건/리스크 상세는 생략해 탐색 밀도를 높인다(상세는 탭 후 화면).
// 색 단독 의미 전달 금지(§8): 등급은 칩 라벨 + 색, 점수는 숫자 + 색을 병행한다.

interface SignalExploreCardProps {
  signal: TradingSignal;
  onPress?: (signal: TradingSignal) => void;
}

function SignalExploreCardBase({ signal, onPress }: SignalExploreCardProps) {
  const { colors, typography: typo } = useTheme();
  const handlePress = useCallback(() => onPress?.(signal), [onPress, signal]);

  // 핵심 근거 1줄: AI 요약 우선, 없으면 점수·등급 기반 평문(항상 '(참고)' 꼬리표 포함).
  const rationale = signal.summary ?? scoreOneLiner(signal.buyScore, signal.grade);

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={handlePress}
      accessibilityRole="button"
      // 카드 단위 합성 읽기(§8-1) — 내부 요소 중복 읽기 방지
      accessibilityLabel={`${signal.corpName}${
        signal.eventType ? `, ${getEventTypeLabel(signal.eventType)}` : ''
      }, 점수 ${signal.buyScore}, ${gradeLabel(signal.grade)}`}
      accessibilityHint="분석 상세 보기"
    >
      <Surface
        elevation={1}
        importantForAccessibility="no-hide-descendants"
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            {signal.eventType ? (
              <Chip
                compact
                mode="flat"
                style={[styles.eventChip, { backgroundColor: colors.surfaceSecondary }]}
                textStyle={[typo.small, { color: colors.textSecondary }]}
              >
                {getEventTypeLabel(signal.eventType)}
              </Chip>
            ) : null}
            <Text style={[typo.bodyMedium, { color: colors.text, flex: 1 }]} numberOfLines={1}>
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

        <View style={styles.gaugeWrap}>
          <SignalMiniGauge score={signal.buyScore} />
        </View>

        <Text
          style={[typo.small, { color: colors.textSecondary, marginTop: spacing.sm }]}
          numberOfLines={2}
        >
          {rationale}
        </Text>
      </Surface>
    </TouchableOpacity>
  );
}

export const SignalExploreCard = React.memo(SignalExploreCardBase);

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
    // DAR-191: 긴 이벤트 라벨이 같은 행 기업명(flex:1)을 짓눌러 "삼…"으로 축약하던 문제 수정.
    // flexShrink로 칩이 먼저 양보하고, maxWidth(행의 ~50%)로 칩 라벨이 대신 잘리게(기업명 우선).
    flexShrink: 1,
    maxWidth: '50%',
  },
  gradeChip: {
    height: 26,
  },
  gaugeWrap: {
    marginTop: spacing.md,
  },
});
