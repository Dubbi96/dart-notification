import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Surface, Chip } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { SignalMiniGauge } from '@components/signals/SignalMiniGauge';
import { SignalFreshnessBadge } from '@components/signals/SignalFreshnessBadge';
import { gradeColor, gradeLabel, scoreOneLiner } from '@utils/signalDisplay';
import { getEventTypeLabel } from '@utils/disclosureType';
import { getSignalTiming } from '@utils/signalTiming';
import { isChartableTicker, navigateToStockChart } from '@utils/stockChartLink';

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
  // DAR-363: 행에서 실시간 차트로 직접 진입(상세 경유 2홉 제거). 6자리 종목코드 있을 때만.
  const handleChartPress = useCallback(() => navigateToStockChart(signal.ticker), [signal.ticker]);
  const chartable = isChartableTicker(signal.ticker);

  // 핵심 근거 1줄: AI 요약 우선, 없으면 점수·등급 기반 평문(항상 '(참고)' 꼬리표 포함).
  const rationale = signal.summary ?? scoreOneLiner(signal.buyScore, signal.grade);

  // DAR-369: 발생 시점 — 신선/만료 무관 항상 표시(판단 가능성). 공시 접수일(rcpNo 앞 8자리) 우선,
  // 없으면 createdAt 을 '신호' 라벨로 폴백(레코드 시각을 공시 발생으로 오인 방지).
  const timing = getSignalTiming({
    relatedDisclosureRcpNo: signal.relatedDisclosureRcpNo,
    createdAt: signal.createdAt,
  });

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={handlePress}
      accessibilityRole="button"
      // 카드 단위 합성 읽기(§8-1) — 내부 요소 중복 읽기 방지
      accessibilityLabel={`${signal.corpName}${
        signal.eventType ? `, ${getEventTypeLabel(signal.eventType)}` : ''
      }, 점수 ${signal.buyScore}, ${gradeLabel(signal.grade)}${
        timing.show ? `, ${timing.accessibleText}` : ''
      }`}
      accessibilityHint="분석 상세 보기"
      // DAR-363: 카드가 no-hide-descendants 로 자식을 a11y 트리에서 숨기므로, 차트 퀵진입은
      // 카드 단위 보조 액션으로 노출해 스크린리더 사용자도 동일 동선을 1탭으로 쓸 수 있게 한다.
      accessibilityActions={chartable ? [{ name: 'chart', label: '실시간 차트 보기' }] : undefined}
      onAccessibilityAction={
        chartable
          ? (event) => {
              if (event.nativeEvent.actionName === 'chart') handleChartPress();
            }
          : undefined
      }
    >
      <Surface
        elevation={1}
        importantForAccessibility="no-hide-descendants"
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <View style={styles.headerRow}>
          <Text style={[typo.bodyMedium, { color: colors.text, flex: 1 }]} numberOfLines={1}>
            {signal.corpName}
          </Text>
          <Chip
            compact
            mode="flat"
            // DAR-305: 고정 높이 칩 — OS 글꼴 확대 시 한글 받침 세로 클리핑 방지 배율 상한(DAR-174 정본).
            maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
            style={[styles.gradeChip, { backgroundColor: colors.surfaceSecondary }]}
            textStyle={[typo.small, { color: gradeColor(signal.grade, colors), fontWeight: '700' }]}
          >
            {gradeLabel(signal.grade)}
          </Chip>
          {/* DAR-363: 행 우측 차트 퀵진입 — 6자리 종목코드 있을 때만(graceful). 카드 탭(상세)과 분리. */}
          {chartable ? (
            <TouchableOpacity
              onPress={handleChartPress}
              hitSlop={{ top: spacing.md, bottom: spacing.md, left: spacing.sm, right: spacing.sm }}
              accessibilityRole="button"
              accessibilityLabel={`${signal.corpName} 실시간 차트 보기`}
              style={styles.chartBtn}
            >
              <Feather name="bar-chart-2" size={20} color={colors.primary} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* DAR-307: 이벤트 칩을 기업명과 별도 행으로 분리(좌측). DAR-369: 같은 행 우측에
            발생 시점을 상시 노출 — 신선/만료 무관 '언제 발생했는지'를 한눈에. */}
        {signal.eventType || timing.show ? (
          <View style={styles.metaRow}>
            {signal.eventType ? (
              <Chip
                compact
                mode="flat"
                // DAR-305: 고정 높이 칩 — OS 글꼴 확대 시 한글 받침 세로 클리핑 방지 배율 상한(DAR-174 정본).
                maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
                // DAR-437: 행 폭 초과 극단 케이스에서도 중간이 아닌 꼬리 생략으로 식별성 보존.
                ellipsizeMode="tail"
                style={[styles.eventChip, { backgroundColor: colors.surfaceSecondary }]}
                // DAR-449/DAR-143: 실제 노출 카드(Explore)도 BuyScoreCard 정본과 동일 대비 보강 —
                // surfaceSecondary 위 textSecondary 12px(≈4.4:1) weight 500으로 대비 여유 확보.
                textStyle={[typo.small, styles.eventChipText, { color: colors.textSecondary }]}
              >
                {getEventTypeLabel(signal.eventType)}
              </Chip>
            ) : null}
            {timing.show ? (
              <View style={styles.timingRow}>
                <Feather name="calendar" size={12} color={colors.textSecondary} />
                <Text
                  style={[typo.small, { color: colors.textSecondary }]}
                  numberOfLines={1}
                  maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
                >
                  {timing.label}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}

        <View style={styles.gaugeWrap}>
          <SignalMiniGauge score={signal.buyScore} />
        </View>

        <Text
          style={[typo.small, { color: colors.textSecondary, marginTop: spacing.sm }]}
          numberOfLines={2}
        >
          {rationale}
        </Text>

        {/* DAR-326: 신선도 배지 — 만료/오래됨만 노출(신선 신호엔 미표시) */}
        <SignalFreshnessBadge
          createdAt={signal.createdAt}
          expiresAt={signal.expiresAt}
          style={styles.freshness}
        />
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
  chartBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  timingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    // 이벤트 칩이 없을 때 좌측 정렬, 있을 때는 행 우측으로 밀려 시점이 가지런히 보인다.
    marginLeft: 'auto',
    flexShrink: 1,
  },
  eventChip: {
    // DAR-305: 고정 height → minHeight. 캡된 큰 글꼴에서도 칩이 늘어나 받침이 잘리지 않는다(평시 동일).
    minHeight: 26,
    // DAR-307: 별도 행 단독 배치 — 행 폭에 맞춰 내용폭으로 자연 정렬(기업명 정렬에 영향 없음).
    alignSelf: 'flex-start',
  },
  // DAR-449/DAR-143: 이벤트 라벨칩 대비 보강(weight 500) — BuyScoreCard 정본과 일치(인라인 회피 StyleSheet 분리).
  eventChipText: {
    fontWeight: '500',
  },
  gradeChip: {
    // DAR-305: 고정 height → minHeight. 캡된 큰 글꼴에서도 칩이 늘어나 받침이 잘리지 않는다(평시 동일).
    minHeight: 26,
  },
  gaugeWrap: {
    marginTop: spacing.md,
  },
  freshness: {
    marginTop: spacing.sm,
  },
});
