import React, { useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Surface } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { PriceChangeChip } from '@components/common/PriceChangeChip';
import { DataLimitBadge } from '@components/common/DataLimitBadge';
import { EquityCurveChart } from '@components/portfolio/EquityCurveChart';
import { SkeletonCard } from '@components/common/SkeletonCard';
import { useIntradayScalp } from '@hooks/useIntradayScalp';
import { formatReturnPct, formatWinRate } from '@utils/numberFormat';

import type { EquityCurvePoint } from '@app-types/simulation.types';
import type { ScalpStatus } from '@app-types/intraday-scalp.types';

// 분봉 단타(forward·실시간 모의) 트랙 표면화 — DAR-416 (BE: DAR-411).
// '전략' 탭의 일봉 4종 백테스트 카드(StrategyComparisonSection)와 ★성격이 다른(forward-only,
// 당일청산, 백테스트 불가) 트랙이라, 같은 랭킹에 섞지 않고 하단 별도 섹션으로 분리한다.
// 시각적 구분: '실시간 모의' 액센트 라벨 + zap 아이콘 + 좌측 액센트 보더 + 백테스트 불가 고지.
// 테마 토큰만(하드코딩 색상 0)·44pt 터치영역·a11y.

const SCALP_ROUTE = '/portfolio/strategy/intraday-scalp';

/** ScalpEquityPoint(tradeDate·cumulativeReturnPct) → 차트 EquityCurvePoint 매핑(미니 forward 곡선). */
function toEquityPoints(status: ScalpStatus): EquityCurvePoint[] {
  return status.equityCurve.map((p) => ({
    snapshotDate: p.tradeDate,
    totalValue: Math.round(status.initialCapital * (1 + p.cumulativeReturnPct / 100)),
    returnPct: p.cumulativeReturnPct,
    kind: 'snapshot',
  }));
}

/** 1차 핵심 지표 — 값을 라벨보다 키운 위계(StrategyCard 패턴 정합). */
function PrimaryStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const { colors, typography: typo } = useTheme();
  return (
    <View
      style={styles.primaryStat}
      accessibilityRole="text"
      accessibilityLabel={`${label} ${value}${sub ? ` ${sub}` : ''}`}
    >
      <Text style={[typo.small, { color: colors.textSecondary }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[typo.body, styles.primaryValue, { color: colors.text }]} numberOfLines={1}>
        {value}
      </Text>
      {sub ? (
        <Text style={[typo.small, { color: colors.textTertiary }]} numberOfLines={1}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

/** '실시간 모의' 구분 액센트 라벨 — 백테스트 4종과 성격이 다름을 형태(zap)+평문으로 고지. */
function LiveSimBadge() {
  const { colors, typography: typo } = useTheme();
  return (
    <View
      style={[styles.liveBadge, { backgroundColor: colors.surfaceSecondary }]}
      accessibilityRole="text"
      accessibilityLabel="실시간 모의 트랙, 백테스트 불가"
    >
      <Feather name="zap" size={12} color={colors.info} />
      <Text style={[typo.small, { color: colors.info }]}>실시간 모의</Text>
    </View>
  );
}

function ScalpCard({ status }: { status: ScalpStatus }) {
  const { colors, typography: typo } = useTheme();
  const points = useMemo(() => toEquityPoints(status), [status]);
  const openDrilldown = useCallback(() => {
    router.push(SCALP_ROUTE);
  }, []);

  return (
    <Surface
      elevation={1}
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border, borderLeftColor: colors.info },
      ]}
    >
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={openDrilldown}
        accessibilityRole="button"
        accessibilityLabel={`분봉 단타 트랙 — 오늘 거래 타임라인 보기. 누적수익 ${formatReturnPct(
          status.cumulativeReturnPct,
        )}`}
        style={styles.cardTap}
      >
        <View style={styles.cardHead}>
          <View style={styles.cardTitleRow}>
            <Text style={[typo.bodyMedium, { color: colors.text }]}>단타 (분봉)</Text>
            <LiveSimBadge />
            {status.lowSample ? <DataLimitBadge sampleCount={status.closedTrades} /> : null}
          </View>
          <PriceChangeChip value={status.cumulativeReturnPct} />
        </View>

        {/* ★백테스트 불가 고지 — 일봉 4종과 성격이 다름(forward-only·당일청산). */}
        <Text style={[typo.small, { color: colors.textTertiary }]} numberOfLines={2}>
          실시간 모의 · 당일청산(오버나잇 금지) · 백테스트 불가 — 과거 검증이 아닌 장중 누적 성과입니다.
        </Text>

        {/* 미니 forward 자산곡선(점 0·1개도 정직하게). */}
        {points.length > 0 ? (
          <EquityCurveChart points={points} initialCapital={status.initialCapital} />
        ) : (
          <Text style={[typo.small, { color: colors.textTertiary, paddingVertical: spacing.sm }]}>
            장중 모의 누적 예정 — 거래가 쌓이면 forward 자산곡선이 표시됩니다.
          </Text>
        )}

        {/* 1차 핵심 3수치 — 누적수익·승률·거래. */}
        <View style={styles.primaryRow}>
          <PrimaryStat label="누적수익" value={formatReturnPct(status.cumulativeReturnPct)} />
          <PrimaryStat
            label="승률"
            value={formatWinRate(status.winRate, { fallback: '표본 부족' })}
            sub={`n=${status.closedTrades}`}
          />
          <PrimaryStat
            label="거래"
            value={`${status.closedTrades}건`}
            sub={status.openPositions > 0 ? `보유 ${status.openPositions}` : '청산 완료'}
          />
        </View>
      </TouchableOpacity>

      {/* 드릴다운 어포던스 — 오늘 거래 타임라인. */}
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={openDrilldown}
        style={[styles.drilldownRow, { borderTopColor: colors.borderLight }]}
        accessibilityRole="button"
        accessibilityLabel="분봉 단타 오늘 거래 타임라인 보기"
      >
        <Feather name="list" size={14} color={colors.primary} />
        <Text style={[typo.small, { color: colors.primary, flex: 1 }]}>오늘 거래 타임라인 보기</Text>
        <Feather name="chevron-right" size={16} color={colors.primary} />
      </TouchableOpacity>
    </Surface>
  );
}

/**
 * 분봉 단타 트랙 섹션 — '전략' 탭 하단 별도 섹션(백테스트 4종과 분리).
 * StrategyComparisonSection 의 ListFooterComponent 로 렌더되어 같은 스크롤에 포함된다.
 * 로딩/에러는 카드 자리에서 graceful(전체 탭을 막지 않음).
 */
export function IntradayScalpSection() {
  const { colors, typography: typo } = useTheme();
  const query = useIntradayScalp();

  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Feather name="zap" size={14} color={colors.info} />
        <Text style={[typo.captionMedium, { color: colors.text }]}>단타 트랙 (분봉·실시간 모의)</Text>
      </View>
      <Text style={[typo.small, { color: colors.textTertiary, marginBottom: spacing.sm }]}>
        위 단타는 장중 forward 누적, 아래 4종은 과거 백테스트 비교라 성격이 다릅니다.
      </Text>

      {query.isLoading ? (
        <SkeletonCard variant="buyScore" />
      ) : query.isError || !query.data ? (
        <Surface
          elevation={1}
          style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, borderLeftColor: colors.info }]}
        >
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            단타 트랙을 불러오지 못했습니다.
          </Text>
          <TouchableOpacity
            onPress={() => query.refetch()}
            style={styles.retryRow}
            accessibilityRole="button"
            accessibilityLabel="단타 트랙 다시 시도"
          >
            <Feather name="refresh-cw" size={14} color={colors.primary} />
            <Text style={[typo.small, { color: colors.primary }]}>다시 시도</Text>
          </TouchableOpacity>
        </Surface>
      ) : (
        <ScalpCard status={query.data} />
      )}

      {/* ★DAR-419: 단타가 최상단으로 올라오면서 구분선을 하단으로 옮겨 아래 4종 비교와 분리 */}
      <View style={[styles.divider, { borderTopColor: colors.border }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  divider: {
    borderTopWidth: 1,
    marginTop: spacing.sm,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderLeftWidth: 3,
    padding: spacing.base,
    gap: spacing.sm,
  },
  cardTap: {
    gap: spacing.sm,
  },
  cardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 1,
    flexWrap: 'wrap',
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  primaryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  primaryStat: {
    flex: 1,
    gap: 2,
  },
  primaryValue: {
    fontWeight: '700',
  },
  drilldownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 44,
    borderTopWidth: 1,
    paddingTop: spacing.xs,
  },
  retryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 44,
  },
});
