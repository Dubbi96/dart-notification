import React, { useMemo, useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { Surface, Banner } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router, useScrollToTop } from 'expo-router';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius, sizing } from '@theme/spacing';
import { InlineDisclosure } from '@components/common/InlineDisclosure';
import { PriceChangeChip } from '@components/common/PriceChangeChip';
import { EmptyState, ErrorState } from '@components/common/StateView';
import { SkeletonList } from '@components/common/SkeletonCard';
import { FEE_BASIS_NOTICE } from '@components/common/feeBasisCopy';
import { EquityCurveChart } from '@components/portfolio/EquityCurveChart';
import { DataLimitBadge } from '@components/common/DataLimitBadge';
import { IntradayScalpSection } from '@components/portfolio/IntradayScalpSection';
import { CoreTrackSection } from '@components/portfolio/CoreTrackSection';
import { useStrategyComparison } from '@hooks/useStrategyComparison';
import { CORE_TRACK_QUERY_KEY } from '@hooks/useCoreTrackScorecard';
import { formatReturnPct, formatWinRate } from '@utils/numberFormat';

import type { StrategyComparison, StrategyPerformance } from '@app-types/strategy-comparison.types';

// 시스템 트레이딩 전략 변형 4종 비교 — DAR-405 (BE: DAR-404).
// 진입/청산/사이징 룰이 다른 4개 백테스트 트랙을 한눈에 비교하고, 탭하면 각 전략의 과거
// 매수/매도 타임라인으로 드릴다운한다. 거장철학(StyleComparisonSection)·페르소나와 별개의
// '트레이딩 로직' 축. 표본 부족은 LOW_SAMPLE 배지로 과신 방지(정직 표기). 테마 토큰만·
// 하드코딩 색상 0·접근성 라벨·44pt 터치영역.

/** Sharpe·MDD·alpha — 측정 불가(null)는 정직하게 '측정 불가'. */
function formatSharpe(value: number | null): string {
  return value === null ? '측정 불가' : value.toFixed(2);
}
function formatSignedPct(value: number | null): string {
  return value === null ? '측정 불가' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

// 우승 배지 — 표본 있는 전략 중 최고 누적수익(C9). 메달 이모지 폐기 → Feather award(형태)
// + 평문 라벨 병행: 렌더/색맹/로케일 비의존, 색 단독 의미 금지(아이콘+텍스트).
function BestBadge() {
  const { colors, typography: typo } = useTheme();
  return (
    <View
      style={[styles.badge, { backgroundColor: colors.successSurface }]}
      accessibilityRole="text"
      accessibilityLabel="현재 최고 수익 전략"
    >
      <Feather name="award" size={12} color={colors.success} />
      <Text
        style={[typo.small, { color: colors.success }]}
        maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
      >
        최고 수익
      </Text>
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

/** 1차 핵심 지표 — 값을 라벨보다 명확히 키운 위계. */
function PrimaryStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const { colors, typography: typo } = useTheme();
  return (
    <View
      style={styles.primaryStat}
      accessibilityRole="text"
      accessibilityLabel={`${label} ${value}${sub ? ` ${sub}` : ''}`}
    >
      <Text
        style={[typo.small, { color: colors.textSecondary, minWidth: 0 }]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {label}
      </Text>
      <Text
        style={[typo.body, styles.primaryValue, { color: colors.text, minWidth: 0 }]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {value}
      </Text>
      {sub ? (
        <Text
          style={[typo.small, { color: colors.textTertiary, minWidth: 0 }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

function StrategyCard({ perf, isBest }: { perf: StrategyPerformance; isBest: boolean }) {
  const { colors, typography: typo } = useTheme();
  const openDrilldown = useCallback(() => {
    router.push(`/portfolio/strategy/${perf.key}`);
  }, [perf.key]);

  return (
    <Surface
      elevation={1}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      {/* 카드 본문 탭 → 매수/매도 타임라인 드릴다운(InlineDisclosure 토글은 자체 터치로 독립). */}
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={openDrilldown}
        accessibilityRole="button"
        accessibilityLabel={`${perf.label} 전략 — 매수/매도 타임라인 보기. 누적수익 ${formatReturnPct(
          perf.cumulativeReturnPct,
        )}`}
        style={styles.cardTap}
      >
        <View style={styles.cardHead}>
          <View style={styles.cardTitleRow}>
            <Text style={[typo.bodyMedium, { color: colors.text }]}>{perf.label}</Text>
            {isBest ? <BestBadge /> : null}
            {perf.lowSample ? <DataLimitBadge /> : null}
          </View>
          <PriceChangeChip value={perf.cumulativeReturnPct} />
        </View>

        <Text style={[typo.small, { color: colors.textTertiary }]} numberOfLines={2}>
          {perf.tagline}
        </Text>

        {/* 1차: 카드 순위를 정하는 핵심 3수치(값 위계 강화) — 기본 정보 압축. */}
        <View style={styles.primaryRow}>
          <PrimaryStat label="누적수익" value={formatReturnPct(perf.cumulativeReturnPct)} />
          <PrimaryStat
            label="승률"
            value={formatWinRate(perf.winRate, { fallback: '표본 부족' })}
            sub={`n=${perf.sampleSize}`}
          />
          <PrimaryStat label="트레이드" value={`${perf.tradeCount}건`} />
        </View>
      </TouchableOpacity>

      {/* C6: 미니 자산곡선 옵션화 — 5장 카드가 한 스크롤에 차트를 모두 펼쳐 과밀해지던 것을
          '한 탭 뒤'로 접어 기본 카드를 압축한다(점 0·1개도 펼치면 정직하게 표기). */}
      <InlineDisclosure label="미니 자산곡선" icon="trending-up">
        {perf.equityCurve.length > 0 ? (
          <EquityCurveChart points={perf.equityCurve} initialCapital={perf.initialCapital} />
        ) : (
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            아직 자산곡선 데이터가 없습니다 — 백테스트 트랙이 누적되면 표시됩니다.
          </Text>
        )}
      </InlineDisclosure>

      {/* 2차: 전문/희귀 지표 + 룰은 한 탭 뒤로(progressive disclosure). */}
      {/* UXR-14 B-1: 'Sharpe' 원어 라벨 → 홈(DAR-446) 정본 어휘 '위험 대비 수익(Sharpe)' 병기.
          접이 라벨은 numberOfLines=1 잘림 방지 위해 축약, 병기는 펼침 내부 StatPair에. */}
      <InlineDisclosure label="상세 — 위험 대비 수익·MDD·진입/청산 룰" icon="info">
        <View style={styles.statGrid}>
          <StatPair label="위험 대비 수익(Sharpe)" value={formatSharpe(perf.sharpe)} />
          <StatPair label="MDD" value={formatSignedPct(perf.maxDrawdownPct)} />
          <StatPair label="vs KOSPI" value={formatSignedPct(perf.benchmarkAlphaPct)} />
          <StatPair label="청산 표본" value={`${perf.sampleSize}건`} />
        </View>
        <View style={styles.ruleBox}>
          <Text style={[typo.small, { color: colors.textSecondary }]}>
            진입 룰 · <Text style={{ color: colors.text }}>{perf.rules.entry}</Text>
          </Text>
          <Text style={[typo.small, { color: colors.textSecondary }]}>
            청산 룰 · <Text style={{ color: colors.text }}>{perf.rules.exit}</Text>
          </Text>
        </View>
      </InlineDisclosure>

      {/* 드릴다운 명시 어포던스 — 카드 본문 탭과 동일 동선(중복 진입점, 발견성↑). */}
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={openDrilldown}
        style={[styles.drilldownRow, { borderTopColor: colors.borderLight }]}
        accessibilityRole="button"
        accessibilityLabel={`${perf.label} 매수/매도 타임라인 보기`}
      >
        <Feather name="list" size={14} color={colors.primary} />
        <Text style={[typo.small, { color: colors.primary, flex: 1 }]}>
          매수/매도 타임라인 보기
        </Text>
        <Feather name="chevron-right" size={sizing.icon.sm} color={colors.primary} />
      </TouchableOpacity>
    </Surface>
  );
}

function ComparisonHeader({ data }: { data: StrategyComparison }) {
  const { colors, typography: typo } = useTheme();
  const best = data.ranking.bestKey
    ? data.strategies.find((s) => s.key === data.ranking.bestKey)
    : null;
  return (
    <View style={styles.headerBox}>
      {/* C6: 백테스트 섹션 헤더 — 위 '단타 트랙'(forward·실시간 모의)과 성격이 다른
          과거 백테스트 비교 구역임을 단타 섹션 헤더와 대칭으로 명시(섹션 구분 강화). */}
      <View style={styles.sectionHead}>
        <Feather name="bar-chart-2" size={14} color={colors.textSecondary} />
        <Text style={[typo.captionMedium, { color: colors.text }]}>
          백테스트 비교 (일봉 4종 변형)
        </Text>
      </View>

      <Banner
        visible
        actions={[]}
        icon="flask"
        style={[styles.banner, { backgroundColor: colors.surfaceSecondary }]}
      >
        <Text style={[typo.small, { color: colors.info }]}>
          시스템 트레이딩 전략 변형 백테스트 비교 — 실제 주문이 아닙니다. 과거 성과는 미래를
          보장하지 않습니다.
        </Text>
      </Banner>

      <Surface
        elevation={1}
        style={[styles.summary, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <Text style={[typo.small, { color: colors.textSecondary }]}>현재 선두 전략</Text>
        {best ? (
          <>
            <Text style={[typo.h3, { color: colors.text, marginTop: spacing.xs }]}>
              {best.label}
            </Text>
            <Text
              style={[typo.captionMedium, { color: colors.textSecondary, marginTop: spacing.xs }]}
            >
              누적수익 {formatReturnPct(best.cumulativeReturnPct)} · 표본 {best.sampleSize}건
            </Text>
          </>
        ) : (
          <Text style={[typo.captionMedium, { color: colors.textTertiary, marginTop: spacing.xs }]}>
            아직 청산 표본이 없어 우열을 가릴 수 없습니다.
          </Text>
        )}
        {/* E-1: 수수료 반영 기준 고지 — 4종 백테스트 수익률도 단타와 동일한 순수익 기준. */}
        <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.xs }]}>
          {FEE_BASIS_NOTICE}
        </Text>
        <View style={styles.headerDisclosure}>
          <InlineDisclosure
            label={data.ranking.allLowSample ? '표본 적음 · 비교 방법 보기' : '비교 방법 보기'}
            icon={data.ranking.allLowSample ? 'alert-triangle' : 'info'}
          >
            <View style={styles.headerDiscRows}>
              {data.ranking.allLowSample ? (
                <Text style={[typo.small, { color: colors.warning }]}>
                  표본이 적어 결론을 과신하지 마세요(표본 {data.lowSampleThreshold}건 미만).
                </Text>
              ) : null}
              <Text style={[typo.small, { color: colors.textTertiary }]}>
                동일 초기자본 {data.initialCapital.toLocaleString('ko-KR')}원으로 진입/청산/사이징
                룰만 달리한 4개 백테스트 트랙을 누적수익률 내림차순으로 비교합니다. 카드를 탭하면 각
                전략의 과거 매수/매도 타임라인을 볼 수 있어요.
              </Text>
            </View>
          </InlineDisclosure>
        </View>
      </Surface>
    </View>
  );
}

// UXR-13 이월 C-1(H4): 당겨 새로고침이 함께 갱신해야 하는 형제 쿼리키 매핑
// (SimulationStatusSection 의 SIM_REFRESH_KEYS 패턴). 이 스크롤은 백테스트 4종 비교와
// 헤더의 IntradayScalpSection(단타 '실시간 모의')을 함께 그리므로, strategy-comparison 만
// refetch 하면 최상단 단타 카드가 stale 로 남는다.
const STRATEGY_REFRESH_KEYS: readonly (readonly string[])[] = [
  ['simulation', 'strategy-comparison'],
  ['simulation', 'intraday-scalp', 'status'],
  // DAR-495: 코어 자산배분 트랙(월단위)도 이 스크롤에 렌더되므로 함께 refetch(stale 방지).
  [...CORE_TRACK_QUERY_KEY],
];

export function StrategyComparisonSection() {
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const query = useStrategyComparison();
  const [isRefreshing, setIsRefreshing] = useState(false);

  // UXR-13 C-8(DAR-181): 하단 탭 재탭 시 최상단 복귀 — 전략 서브탭 FlatList 자체 등록.
  // 포트폴리오 화면의 listRef 는 실전·내 모의 리스트만 커버하므로 섹션이 스스로 등록한다.
  const listRef = useRef<FlatList<StrategyPerformance>>(null);
  useScrollToTop(listRef);

  // 당겨 새로고침: 이 화면이 실제로 그리는 쿼리(전략 4종+단타)를 일괄 refetch (UXR-13 이월 C-1).
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all(
        STRATEGY_REFRESH_KEYS.map((queryKey) =>
          queryClient.refetchQueries({ queryKey, exact: true }),
        ),
      );
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient]);

  // 랭킹(누적수익률 내림차순)대로 카드 정렬.
  const ordered = useMemo<StrategyPerformance[]>(() => {
    const data = query.data;
    if (!data) return [];
    const byKey = new Map(data.strategies.map((s) => [s.key, s]));
    return data.ranking.ranking
      .map((key) => byKey.get(key))
      .filter((s): s is StrategyPerformance => !!s);
  }, [query.data]);

  const renderCard = useCallback(
    ({ item }: { item: StrategyPerformance }) => (
      <StrategyCard perf={item} isBest={item.key === query.data?.ranking.bestKey} />
    ),
    [query.data?.ranking.bestKey],
  );

  if (query.isLoading) return <SkeletonList variant="buyScore" />;
  if (query.isError) {
    return <ErrorState title="전략별 성과를 불러오지 못했습니다." onRetry={query.refetch} />;
  }

  const data = query.data;

  return (
    <FlatList
      ref={listRef}
      data={ordered}
      renderItem={renderCard}
      keyExtractor={(item) => item.key}
      initialNumToRender={4}
      maxToRenderPerBatch={4}
      windowSize={5}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
      refreshing={isRefreshing}
      onRefresh={handleRefresh}
      // ★DAR-419: 분봉 단타(forward·실시간 모의) 트랙을 최상단으로 이동.
      //   단타 섹션 → (구분선) → 4종 백테스트 비교 헤더 순. 성격이 달라 같은 카드
      //   랭킹에 섞지 않되, 위계상 단타를 상단에 강조한다. 단타는 자체 훅이라 data
      //   유무와 무관하게 항상 렌더하고, ComparisonHeader 만 data 가드를 유지한다.
      ListHeaderComponent={
        <>
          {/* ★DAR-495: 코어 자산배분 트랙(월단위)을 최상단으로 — 단타·백테스트 4종과 유형이
              다른(월 1회 리밸런싱·모멘텀 배분) 트랙이라 같은 랭킹에 섞지 않고 별도 섹션 카드로
              노출한다(감사 C2 — 사용자 표면의 유형 구분). 자체 훅이라 data 유무와 무관하게 렌더. */}
          <CoreTrackSection />
          <IntradayScalpSection />
          {data ? <ComparisonHeader data={data} /> : null}
        </>
      }
      ListEmptyComponent={
        <EmptyState
          icon="bar-chart-2"
          title="아직 전략별 데이터가 없습니다."
          description="전략 변형 백테스트 트랙이 누적되면 비교가 표시됩니다."
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
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
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
  },
  badge: {
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
  ruleBox: {
    gap: spacing.xs,
  },
  drilldownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 44,
    borderTopWidth: 1,
    paddingTop: spacing.xs,
  },
  headerDisclosure: {
    marginTop: spacing.xs,
  },
  headerDiscRows: {
    gap: spacing.xs,
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
