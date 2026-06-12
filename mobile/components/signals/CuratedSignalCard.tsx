import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Surface, Chip } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { RiskStatusBadges, summarizeRiskStatus } from '@components/common/RiskStatusBadges';
import { ScoreGauge } from '@components/common/ScoreGauge';
import { useStockRiskStatus } from '@hooks/useStockRiskStatus';
import { useStockQuotes } from '@hooks/useStockQuotes';
import { StockPriceBadge } from '@components/common/StockPriceBadge';
import { gradeColor, gradeLabel, scoreOneLiner } from '@utils/signalDisplay';
import { getEventTypeLabel } from '@utils/disclosureType';

import type { TradingSignal } from '@app-types/signal.types';

// L1 "오늘 주목할 신호" 큐레이션 카드(DAR-116). 가로 카루셀 1장.
// 핵심 4요소만: 기업명 + 이벤트유형 칩 + 등급 칩 + Buy Score 게이지.
// + 추천 이유 1줄(scoreOneLiner) + RiskStatusBadges(위험 즉시 노출, §6).
// 정보 과잉 제거(§3-d): 진입조건·AI요약 3줄·riskFlags는 카드에 싣지 않는다(전체는 /signals/[id]).

const CARD_WIDTH = 272;

interface CuratedSignalCardProps {
  signal: TradingSignal;
  onPress: (signal: TradingSignal) => void;
}

function CuratedSignalCardBase({ signal, onPress }: CuratedSignalCardProps) {
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
      accessibilityRole="button"
      accessibilityLabel={`${signal.corpName} 매수 신호, Buy Score ${signal.buyScore}, ${gradeLabel(
        signal.grade,
      )}${riskSummary ? `, ${riskSummary}` : ''}`}
      accessibilityActions={[{ name: 'activate', label: '신호 상세 보기' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'activate') handlePress();
      }}
    >
      <Surface
        elevation={2}
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
              style={[styles.eventChip, { backgroundColor: colors.surfaceSecondary }]}
              textStyle={[typo.small, { color: colors.textSecondary }]}
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
          </View>
        )}
      </Surface>
    </TouchableOpacity>
  );
}

export const CuratedSignalCard = React.memo(CuratedSignalCardBase);
export const CURATED_CARD_WIDTH = CARD_WIDTH;

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
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
    height: 26,
  },
  gradeChip: {
    height: 26,
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
