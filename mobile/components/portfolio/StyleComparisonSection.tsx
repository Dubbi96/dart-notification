import React, { useMemo, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { Surface, Banner } from 'react-native-paper';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { PriceChangeChip } from '@components/common/PriceChangeChip';
import { EmptyState, ErrorState } from '@components/common/StateView';
import { SkeletonList } from '@components/common/SkeletonCard';
import { EquityCurveChart } from '@components/portfolio/EquityCurveChart';
import { DataLimitBadge } from '@components/common/DataLimitBadge';
import { useStyleComparison } from '@hooks/useStyleComparison';

import type {
  StyleComparison,
  StylePerformance,
} from '@app-types/style-comparison.types';

// 철학 스타일별(버핏·린치·그린블라트·드러켄밀러) 모의운용 성과 비교 — DAR-76 (P-D).
// 어느 거장 스타일이 한국시장 공시에서 실제 모의수익을 내는지 데이터로 변별한다(Main Thesis B).
// 스타일별 자산곡선·승률·누적수익·표본 + 졸업지표(Sharpe·MDD·alpha)를 비교. 표본 부족은
// LOW_SAMPLE 배지로 과신 방지(정직 표기). 테마 토큰만 사용·하드코딩 색상 0·접근성 라벨.

/** 승률(0~1) 표시 — 표본 없으면 '표본 부족' */
function formatWinRate(value: number | null): string {
  return value === null ? '표본 부족' : `${Math.round(value * 100)}%`;
}

/** 수익률(%) 부호 포함 표기 */
function formatPct(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

/** Sharpe·MDD·alpha — 측정 불가(null)는 정직하게 '측정 불가' */
function formatSharpe(value: number | null): string {
  return value === null ? '측정 불가' : value.toFixed(2);
}
function formatSignedPct(value: number | null): string {
  return value === null ? '측정 불가' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

/** 우승 배지 — 표본 있는 스타일 중 최고 누적수익률 */
function BestBadge() {
  const { colors, typography: typo } = useTheme();
  return (
    <View
      style={[styles.badge, { backgroundColor: colors.successSurface }]}
      accessibilityRole="text"
      accessibilityLabel="현재 최고 수익 스타일"
    >
      <Text style={[typo.small, { color: colors.success }]}>최고 수익</Text>
    </View>
  );
}

function StatPair({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const { colors, typography: typo } = useTheme();
  return (
    <View
      style={styles.statPair}
      accessibilityRole="text"
      accessibilityLabel={`${label} ${value}${sub ? ` ${sub}` : ''}`}
    >
      <Text style={[typo.small, { color: colors.textSecondary }]}>{label}</Text>
      <Text style={[typo.captionMedium, { color: colors.text }]}>
        {value}
        {sub ? (
          <Text style={[typo.small, { color: colors.textTertiary }]}>{`  ${sub}`}</Text>
        ) : null}
      </Text>
    </View>
  );
}

function StyleCard({ perf, isBest }: { perf: StylePerformance; isBest: boolean }) {
  const { colors, typography: typo } = useTheme();
  const sc = perf.scorecard;
  const g = perf.graduation;
  return (
    <Surface
      elevation={1}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.cardHead}>
        <View style={styles.cardTitleRow}>
          <Text style={[typo.bodyMedium, { color: colors.text }]}>{perf.label}</Text>
          {isBest ? <BestBadge /> : null}
          {perf.lowSample ? <DataLimitBadge /> : null}
        </View>
        <PriceChangeChip value={sc.cumulativeReturnPct} amount={sc.totalNetPnl} />
      </View>

      {/* 스타일별 자산곡선(점 0·1개도 정직하게) */}
      {perf.equityCurve.length > 0 ? (
        <EquityCurveChart points={perf.equityCurve} initialCapital={perf.initialCapital} />
      ) : (
        <Text style={[typo.small, { color: colors.textTertiary, paddingVertical: spacing.sm }]}>
          아직 자산곡선 데이터가 없습니다 — 사이클 누적 후 표시됩니다.
        </Text>
      )}

      <View style={styles.statGrid}>
        <StatPair label="승률" value={formatWinRate(sc.winRate)} sub={`n=${sc.sampleSize}`} />
        <StatPair label="누적수익" value={formatPct(sc.cumulativeReturnPct)} />
        <StatPair label="보유 포지션" value={`${perf.openPositions}개`} />
        <StatPair
          label="신호 적중률(D+5)"
          value={`${Math.round(g.hitRatePct)}%`}
          sub={`n=${g.hitRateSampleSize}`}
        />
        <StatPair label="Sharpe" value={formatSharpe(g.sharpe)} />
        <StatPair label="MDD" value={formatSignedPct(g.mddPct)} />
        <StatPair label="vs KOSPI" value={formatSignedPct(g.benchmarkAlphaPct)} />
      </View>
    </Surface>
  );
}

function ComparisonHeader({ data }: { data: StyleComparison }) {
  const { colors, typography: typo } = useTheme();
  const best = data.ranking.bestStyle
    ? data.styles.find((s) => s.style === data.ranking.bestStyle)
    : null;
  return (
    <View style={styles.headerBox}>
      <Banner
        visible
        actions={[]}
        icon="flask"
        style={[styles.banner, { backgroundColor: colors.surfaceSecondary }]}
      >
        <Text style={[typo.small, { color: colors.info }]}>
          철학 스타일별 모의운용 비교 — 실제 주문이 아닙니다. 졸업지표는 참고용입니다.
        </Text>
      </Banner>

      <Surface
        elevation={1}
        style={[styles.summary, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Text style={[typo.small, { color: colors.textSecondary }]}>현재 선두 스타일</Text>
        {best ? (
          <>
            <Text style={[typo.h3, { color: colors.text, marginTop: spacing.xs }]}>
              {best.label}
            </Text>
            <Text style={[typo.captionMedium, { color: colors.textSecondary, marginTop: spacing.xs }]}>
              누적수익 {formatPct(best.scorecard.cumulativeReturnPct)} · 표본 {best.scorecard.sampleSize}건
            </Text>
          </>
        ) : (
          <Text style={[typo.captionMedium, { color: colors.textTertiary, marginTop: spacing.xs }]}>
            아직 청산 표본이 없어 우열을 가릴 수 없습니다.
          </Text>
        )}
        {data.ranking.allLowSample ? (
          <Text style={[typo.small, { color: colors.warning, marginTop: spacing.sm }]}>
            표본이 적어 결론을 과신하지 마세요(표본 {data.lowSampleThreshold}건 미만).
          </Text>
        ) : null}
        <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.sm }]}>
          진입 기준: 스타일 적합도 {data.minEntryFit}점 이상(재무 기반 Rule)
        </Text>
      </Surface>
    </View>
  );
}

export function StyleComparisonSection() {
  const { colors } = useTheme();
  const query = useStyleComparison();

  // 랭킹(누적수익률 내림차순)대로 카드 정렬
  const ordered = useMemo<StylePerformance[]>(() => {
    const data = query.data;
    if (!data) return [];
    const byStyle = new Map(data.styles.map((s) => [s.style, s]));
    return data.ranking.ranking
      .map((style) => byStyle.get(style))
      .filter((s): s is StylePerformance => !!s);
  }, [query.data]);

  const renderCard = useCallback(
    ({ item }: { item: StylePerformance }) => (
      <StyleCard perf={item} isBest={item.style === query.data?.ranking.bestStyle} />
    ),
    [query.data?.ranking.bestStyle],
  );

  if (query.isLoading) return <SkeletonList variant="buyScore" />;
  if (query.isError) {
    return (
      <ErrorState title="스타일별 성과를 불러오지 못했습니다." onRetry={query.refetch} />
    );
  }

  const data = query.data;

  return (
    <FlatList
      data={ordered}
      renderItem={renderCard}
      keyExtractor={(item) => item.style}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
      refreshing={query.isRefetching}
          onRefresh={query.refetch}
      ListHeaderComponent={data ? <ComparisonHeader data={data} /> : null}
      ListEmptyComponent={
        <EmptyState
          icon="bar-chart-2"
          title="아직 스타일별 데이터가 없습니다."
          description="스타일별 모의운용 사이클이 누적되면 비교가 표시됩니다."
        />
      }
      style={{ backgroundColor: colors.background }}
    />
  );
}

const styles = StyleSheet.create({
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
    flexGrow: 1,
  },
  headerBox: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  banner: {
    borderRadius: radius.md,
  },
  summary: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
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
  },
  badge: {
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.xs,
  },
  statPair: {
    width: '50%',
    paddingVertical: spacing.xs / 2,
    gap: 2,
  },
});
