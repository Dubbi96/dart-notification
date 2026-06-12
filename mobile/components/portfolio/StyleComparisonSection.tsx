import React, { useMemo, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, Pressable } from 'react-native';
import { Surface, Banner } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { PriceChangeChip } from '@components/common/PriceChangeChip';
import { EmptyState, ErrorState } from '@components/common/StateView';
import { SkeletonList } from '@components/common/SkeletonCard';
import { EquityCurveChart } from '@components/portfolio/EquityCurveChart';
import { DataLimitBadge } from '@components/common/DataLimitBadge';
import { MarketRegimeCard } from '@components/persona/MarketRegimeCard';
import { useStyleComparison } from '@hooks/useStyleComparison';
import { usePersonaOverview } from '@hooks/usePersonaOverview';
import { usePersonaStore } from '@stores/personaStore';
import { formatReturnPct, formatWinRate } from '@utils/numberFormat';

import type {
  StyleComparison,
  StylePerformance,
} from '@app-types/style-comparison.types';

// 철학 스타일별(버핏·린치·그린블라트·드러켄밀러) 모의운용 성과 비교 — DAR-76 (P-D).
// 어느 거장 스타일이 한국시장 공시에서 실제 모의수익을 내는지 데이터로 변별한다(Main Thesis B).
// 스타일별 자산곡선·승률·누적수익·표본 + 졸업지표(Sharpe·MDD·alpha)를 비교. 표본 부족은
// LOW_SAMPLE 배지로 과신 방지(정직 표기). 테마 토큰만 사용·하드코딩 색상 0·접근성 라벨.

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
        <StatPair label="승률" value={formatWinRate(sc.winRate, { fallback: '표본 부족' })} sub={`n=${sc.sampleSize}`} />
        <StatPair label="누적수익" value={formatReturnPct(sc.cumulativeReturnPct)} />
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

// persona 추천 + 자동매매 persona 선택 진입 — DAR-131.
// 스타일 비교 상단에 '현재 장 적합 persona' 추천 카드와 persona 선택 화면 진입 CTA를 얹는다.
// persona 성과 데이터(usePersonaOverview)는 스타일 비교의 상위집합 — 로드 전엔 graceful 미표시.
function PersonaPickerHeader() {
  const { colors, typography: typo } = useTheme();
  const personaQuery = usePersonaOverview();
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);

  const data = personaQuery.data;
  const selected = data?.personas.find((p) => p.performance.style === selectedPersona);

  const goSelect = useCallback(() => router.push('/persona'), []);

  return (
    <View style={styles.personaBox}>
      {data ? (
        <MarketRegimeCard regime={data.regime} personas={data.personas} dataLimited={data.dataLimited} />
      ) : null}

      <Pressable
        onPress={goSelect}
        accessibilityRole="button"
        accessibilityLabel={
          selected
            ? `자동매매 persona 선택 화면 열기. 현재 선택: ${selected.performance.label}(모의)`
            : '자동매매 persona 선택 화면 열기'
        }
      >
        <Surface
          elevation={1}
          style={[styles.ctaCard, { backgroundColor: colors.surface, borderColor: colors.primary }]}
        >
          <View style={styles.ctaTextCol}>
            <Text style={[typo.captionMedium, { color: colors.text }]}>
              {selected ? '선택한 모의운용 persona' : '자동매매 persona 선택하기'}
            </Text>
            <Text style={[typo.small, { color: colors.textSecondary, marginTop: 2 }]}>
              {selected
                ? `${selected.performance.label} · 모의 운용(실주문 아님)`
                : '현재 장 추천을 보고 거장 철학을 고르세요 — 모의/선택까지'}
            </Text>
          </View>
          <Feather name="chevron-right" size={20} color={colors.primary} />
        </Surface>
      </Pressable>
    </View>
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
              누적수익 {formatReturnPct(best.scorecard.cumulativeReturnPct)} · 표본 {best.scorecard.sampleSize}건
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
      ListHeaderComponent={
        <>
          <PersonaPickerHeader />
          {data ? <ComparisonHeader data={data} /> : null}
        </>
      }
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
  personaBox: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  ctaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
    gap: spacing.sm,
  },
  ctaTextCol: {
    flexShrink: 1,
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
