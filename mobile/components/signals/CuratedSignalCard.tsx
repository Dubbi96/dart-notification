import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Surface, Chip } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { CAROUSEL_GAP } from '@utils/carouselMetrics';
import { RiskStatusBadges, summarizeRiskStatus } from '@components/common/RiskStatusBadges';
import { ScoreGauge } from '@components/common/ScoreGauge';
import { SignalFreshnessBadge } from '@components/signals/SignalFreshnessBadge';
import { useStockRiskStatus } from '@hooks/useStockRiskStatus';
import { useStockQuotes } from '@hooks/useStockQuotes';
import { StockPriceBadge } from '@components/common/StockPriceBadge';
import { gradeColor, gradeLabel, scoreOneLiner } from '@utils/signalDisplay';
import { buildSignalCardA11yLabel } from '@utils/signalTerms';
import { getEventTypeLabel } from '@utils/disclosureType';

import type { TradingSignal } from '@app-types/signal.types';

// L1 "오늘 주목할 신호" 큐레이션 카드(DAR-116). 가로 카루셀 1장.
// 핵심 4요소만: 기업명 + 이벤트유형 칩 + 등급 칩 + Buy Score 게이지.
// + 추천 이유 1줄(scoreOneLiner) + RiskStatusBadges(위험 즉시 노출, §6).
// 정보 과잉 제거(§3-d): 진입조건·AI요약 3줄·riskFlags는 카드에 싣지 않는다(전체는 /signals/[id]).

interface CuratedSignalCardProps {
  signal: TradingSignal;
  onPress: (signal: TradingSignal) => void;
  /** 화면 폭 반응형 카드 폭(DAR-301). */
  cardWidth: number;
}

function CuratedSignalCardBase({ signal, onPress, cardWidth }: CuratedSignalCardProps) {
  const { colors, typography: typo } = useTheme();
  const isBlocked = signal.grade === 'BLOCKED';
  const handlePress = useCallback(() => onPress(signal), [onPress, signal]);
  // 손실 회피 1차 방어선(§6): 관리종목·거래정지 배지(DART 근사값). 추천 카드에도 즉시 노출.
  const { data: riskStatus } = useStockRiskStatus({ corpCode: signal.corpCode });
  const riskSummary = summarizeRiskStatus(riskStatus);
  // DAR-158: 최신 시세 배지(현재가·전일대비%). ticker(종목코드) 없으면 미표시.
  const { quotes } = useStockQuotes([signal.ticker]);
  const quote = signal.ticker ? quotes[signal.ticker] : null;

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={handlePress}
      // DAR-319: 카드 간 간격을 carousel contentContainer 의 gap 대신 각 카드 marginRight 로
      // 결정론 적용(스켈레톤과 동일 방식). Android RN0.85 Fabric 가로 FlatList 의
      // contentContainerStyle gap 미적용 시 카드가 붙어/겹쳐 보이는 문제 방지.
      style={styles.cardTouchable}
      accessibilityRole="button"
      // 용어 위계 L2 고정(DAR-217): 카드 a11y는 SSOT 빌더로 '매수 신호'+'Buy Score' 일관.
      accessibilityLabel={buildSignalCardA11yLabel({
        corpName: signal.corpName,
        buyScore: signal.buyScore,
        gradeText: gradeLabel(signal.grade),
        riskSummary,
      })}
      accessibilityActions={[{ name: 'activate', label: '신호 상세 보기' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'activate') handlePress();
      }}
    >
      <Surface
        elevation={2}
        importantForAccessibility="no-hide-descendants"
        style={[styles.card, { width: cardWidth, backgroundColor: colors.surface, borderColor: colors.border }]}
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
        </View>

        {signal.eventType ? (
          // eventType 단일 노출(§3-d 중복 제거) — 칩 1곳만.
          <View style={styles.metaRow}>
            <Chip
              compact
              mode="flat"
              // DAR-305: 고정 높이 칩 — OS 글꼴 확대 시 한글 받침 세로 클리핑 방지 배율 상한(DAR-174 정본).
              maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
              // DAR-437: 고정폭 카루셀 카드라 라벨 폭 초과 위험이 가장 큼 — 꼬리 생략 명시(중간 잘림 방지).
              ellipsizeMode="tail"
              style={[styles.eventChip, { backgroundColor: colors.surfaceSecondary }]}
              // DAR-449/DAR-143: 실제 노출 카드(Curated)도 BuyScoreCard 정본과 동일 대비 보강 —
              // surfaceSecondary 위 textSecondary 12px(≈4.4:1) weight 500으로 대비 여유 확보.
              textStyle={[typo.small, styles.eventChipText, { color: colors.textSecondary }]}
            >
              {getEventTypeLabel(signal.eventType)}
            </Chip>
          </View>
        ) : null}

        {/* 위험 배지(위험 없으면 미표시) — RiskStatusBadges 단일 채널(§3-d) */}
        <RiskStatusBadges status={riskStatus} compact style={styles.riskBadges} />

        {/* DAR-158: 가격 배지 — 시세 있을 때만(없으면 미표시), 스파크라인 생략(카드 밀도). */}
        {quote ? (
          <StockPriceBadge quote={quote} showSparkline={false} style={styles.priceBadge} />
        ) : null}

        {isBlocked ? (
          <View style={[styles.blockedBox, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}>
            <Feather name="slash" size={14} color={colors.textTertiary} />
            <Text style={[typo.small, { color: colors.textTertiary, flex: 1 }]} numberOfLines={2}>
              {signal.blockedReason ?? '조건 미충족으로 차단된 신호입니다.'}
            </Text>
          </View>
        ) : (
          <View style={styles.gaugeWrap}>
            <ScoreGauge
              score={signal.buyScore}
              kind="buy"
              statusText={gradeLabel(signal.grade)}
              oneLiner={scoreOneLiner(signal.buyScore, signal.grade)}
              accessibilityHidden
            />
            {/* DAR-326: 신선도 배지 — 만료/오래됨만 노출(신선 신호엔 미표시) */}
            <SignalFreshnessBadge
              createdAt={signal.createdAt}
              expiresAt={signal.expiresAt}
              style={styles.freshness}
            />
          </View>
        )}
      </Surface>
    </TouchableOpacity>
  );
}

export const CuratedSignalCard = React.memo(CuratedSignalCardBase);

const styles = StyleSheet.create({
  cardTouchable: {
    // DAR-319: 카드 단위 간격(= snapToInterval - cardWidth). carousel gap 비의존(크로스플랫폼).
    marginRight: CAROUSEL_GAP,
  },
  card: {
    // 폭은 useCarouselCardWidth 로 인라인 주입(DAR-301, 화면 폭 반응형).
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
  metaRow: {
    flexDirection: 'row',
    marginTop: spacing.xs,
  },
  eventChip: {
    // DAR-305: 고정 height → minHeight. 캡된 큰 글꼴에서도 칩이 늘어나 받침이 잘리지 않는다(평시 동일).
    minHeight: 26,
    // DAR-437: 카드 폭에 맞춰 내용폭으로 자연 정렬(짧은 라벨은 온전히, 초과 시 꼬리 생략).
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
  riskBadges: {
    marginTop: spacing.sm,
  },
  priceBadge: {
    marginTop: spacing.sm,
  },
  gaugeWrap: {
    marginTop: spacing.md,
  },
  freshness: {
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
});
