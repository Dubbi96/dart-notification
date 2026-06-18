import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Surface, Chip } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { RiskStatusBadges, summarizeRiskStatus } from '@components/common/RiskStatusBadges';
import { ScoreGauge } from '@components/common/ScoreGauge';
import { SignalFreshnessBadge } from '@components/signals/SignalFreshnessBadge';
import { useStockRiskStatus } from '@hooks/useStockRiskStatus';
import { gradeColor, gradeLabel, scoreOneLiner } from '@utils/signalDisplay';
import { buildSignalCardA11yLabel } from '@utils/signalTerms';
import { getEventTypeLabel } from '@utils/disclosureType';

import type { TradingSignal } from '@app-types/signal.types';

// 매수 신호 카드(기획 §3 SCR-SIGNALS) — DAR-118 압축: 9요소 → 핵심 4요소.
// 핵심 4요소: 기업명 + 이벤트유형 칩(1곳) + 등급 칩 + Buy Score 게이지(+추천 이유 1줄).
// 미룬 정보(전체는 /signals/[id]): 진입조건 전체→"N/M 충족" 요약 1줄, AI요약 3줄→제거,
// riskFlags 전체→개수 배지. 위험은 RiskStatusBadges 단일 채널, AiReferenceLabel은 피드 푸터 1회.
// 색상 단독 의미 전달 금지 — 색상 + 텍스트 레이블 + 아이콘 병행.

interface BuyScoreCardProps {
  signal: TradingSignal;
  onPress?: (signal: TradingSignal) => void;
}

function BuyScoreCardBase({ signal, onPress }: BuyScoreCardProps) {
  const { colors, typography: typo } = useTheme();
  const isBlocked = signal.grade === 'BLOCKED';
  const handlePress = useCallback(() => onPress?.(signal), [onPress, signal]);
  // DAR-99: 관리종목·거래정지·상폐위험 배지(DART 폴백·근사값). 손실 회피 1차 방어선·단일 채널.
  const { data: riskStatus } = useStockRiskStatus({ corpCode: signal.corpCode });
  const riskSummary = summarizeRiskStatus(riskStatus);

  // 진입조건 요약(§3-c): 전체 체크리스트 대신 "N/M 충족" 1줄. 전체는 상세 화면.
  const entrySummary = useMemo(() => {
    const total = signal.entryConditions.length;
    if (total === 0) return null;
    const met = signal.entryConditions.filter((c) => c.met).length;
    return { met, total };
  }, [signal.entryConditions]);

  const riskFlagCount = signal.riskFlags.length;

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={handlePress}
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
              // eventType 단일 노출(§3-d 중복 제거) — 헤더 칩 1곳만.
              <Chip
                compact
                mode="flat"
                // DAR-305: 고정 높이 칩 — OS 글꼴 확대 시 한글 받침 세로 클리핑 방지 배율 상한(DAR-174 정본).
                maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
                style={[styles.eventChip, { backgroundColor: colors.surfaceSecondary }]}
                // DAR-143: surfaceSecondary 위 textSecondary 12px(≈4.4:1) 대비 여유 보강 — weight 500.
                textStyle={[typo.small, styles.eventChipText, { color: colors.textSecondary }]}
              >
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
            // DAR-305: 고정 높이 칩 — OS 글꼴 확대 시 한글 받침 세로 클리핑 방지 배율 상한(DAR-174 정본).
            maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
            style={[styles.gradeChip, { backgroundColor: colors.surfaceSecondary }]}
            textStyle={[typo.small, { color: gradeColor(signal.grade, colors), fontWeight: '700' }]}
          >
            {gradeLabel(signal.grade)}
          </Chip>
        </View>

        {/* DAR-99: 위험 배지(위험 없으면 미표시) — 단일 채널(riskFlags 평문 노출 제거) */}
        <RiskStatusBadges status={riskStatus} compact style={styles.riskBadges} />

        {isBlocked ? (
          <View style={[styles.blockedBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Feather name="slash" size={14} color={colors.textTertiary} />
            <Text style={[typo.small, { color: colors.textTertiary, flex: 1 }]} numberOfLines={2}>
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
                oneLiner={scoreOneLiner(signal.buyScore, signal.grade)}
                accessibilityHidden
              />
            </View>

            {/* 요약 메타 1줄(§3-c): 진입조건 충족수 + 리스크 개수 배지. 전체는 상세로. */}
            {entrySummary || riskFlagCount > 0 ? (
              <View style={styles.metaRow}>
                {entrySummary ? (
                  <View style={styles.metaItem}>
                    <Feather name="check-circle" size={13} color={colors.textSecondary} />
                    <Text style={[typo.small, { color: colors.textSecondary }]}>
                      진입조건 {entrySummary.met}/{entrySummary.total} 충족
                    </Text>
                  </View>
                ) : null}
                {riskFlagCount > 0 ? (
                  <View style={styles.metaItem}>
                    <Feather name="alert-triangle" size={13} color={colors.warning} />
                    <Text style={[typo.small, { color: colors.textSecondary }]}>
                      리스크 {riskFlagCount}
                    </Text>
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* DAR-326: 신선도 배지 — 만료/오래됨만 노출(신선 신호엔 미표시) */}
            <SignalFreshnessBadge
              createdAt={signal.createdAt}
              expiresAt={signal.expiresAt}
              style={styles.freshness}
            />
          </>
        )}
      </Surface>
    </TouchableOpacity>
  );
}

export const BuyScoreCard = React.memo(BuyScoreCardBase);

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
    // DAR-305: 고정 height → minHeight. 캡된 큰 글꼴에서도 칩이 늘어나 받침이 잘리지 않는다(평시 동일).
    minHeight: 26,
    // DAR-191: 긴 이벤트 라벨이 같은 행 기업명을 짓눌러 "삼…"으로 축약하던 문제 수정.
    // flexShrink로 칩이 먼저 양보하고, maxWidth(행의 ~50%)로 칩 라벨이 대신 잘리게(기업명 우선).
    flexShrink: 1,
    maxWidth: '50%',
  },
  // DAR-143: 이벤트 라벨칩 대비 보강(weight 500) — 인라인 스타일 경고 회피용 StyleSheet 분리.
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
  gaugeWrap: {
    marginTop: spacing.md,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  freshness: {
    marginTop: spacing.sm,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
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
