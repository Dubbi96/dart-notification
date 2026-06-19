import React, { useState, useCallback, useMemo, useRef } from 'react';
import { View, Text, FlatList, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Surface, Banner } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router, useScrollToTop } from 'expo-router';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { PositionCard } from '@components/portfolio/PositionCard';
import { EmptyState, ApiErrorState } from '@components/common/StateView';
import { GuestPrompt } from '@components/common/GuestPrompt';
import { emptyStateCopy } from '@components/common/emptyStateCopy';
import { guestPromptCopy } from '@components/common/guestPromptCopy';
import { SkeletonList } from '@components/common/SkeletonCard';
import { useAuthStore } from '@stores/authStore';
import { SimulationStatusSection } from '@components/portfolio/SimulationStatusSection';
import { StyleComparisonSection } from '@components/portfolio/StyleComparisonSection';
import { PersonaTrackSection } from '@components/portfolio/PersonaTrackSection';
import { TodayCheckSlot } from '@components/portfolio/TodayCheckSlot';
import { PositionSearchBar } from '@components/portfolio/PositionSearchBar';
import { PortfolioRiskBadge } from '@components/portfolio/PortfolioRiskBadge';
import {
  usePositions,
  usePortfolioSummary,
  usePortfolioRisk,
  usePaperPortfolio,
} from '@hooks/usePortfolio';
import { pnlColor, formatPnlPercent } from '@utils/signalDisplay';
import { currentPortfolioBasisLabel } from '@utils/marketQuoteDisplay';
import { dedupeByStock } from '@utils/dedupe';
import { PORTFOLIO_TABS, pickLiveEmptyState } from '@utils/portfolioTabs';

import type { Position } from '@app-types/portfolio.types';
import type { SortKey } from '@components/portfolio/PositionSearchBar';
import type { PortfolioSubTab } from '@utils/portfolioTabs';

// VIOLATED/EXPIRED 포지션을 리스트 최상단으로 고정하는 정렬 우선순위.
const STATUS_ORDER: Record<Position['thesisStatus'], number> = {
  VIOLATED: 0,
  EXPIRED: 1,
  WATCHING: 2,
  ACTIVE: 3,
};

export default function PortfolioScreen() {
  const { colors, typography: typo } = useTheme();
  const [subTab, setSubTab] = useState<PortfolioSubTab>('live');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('urgency');
  // DAR-356: '오늘 점검할 포지션'은 요약 아래로 강등(세컨더리)하고 기본 접힘 — 요약 글랜스 보호.
  const [showTodayCheck, setShowTodayCheck] = useState(false);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // DAR-181: 탭 재탭 시 최상단 복귀. 실전·모의 FlatList는 상호배타로 하나만 마운트되어
  // 동일 ref를 공유한다(비활성 list는 언마운트되어 ref.current=null).
  const listRef = useRef<FlatList<Position>>(null);
  useScrollToTop(listRef);

  const positionsQuery = usePositions();
  const summaryQuery = usePortfolioSummary();
  const riskQuery = usePortfolioRisk();
  const paperQuery = usePaperPortfolio();

  const handlePositionPress = useCallback((position: Position) => {
    router.push(`/portfolio/${position.portfolioId}/position/${position.id}`);
  }, []);

  const sortedPositions = useMemo(() => {
    const data = positionsQuery.data ?? [];
    const sorted = [...data].sort(
      (a, b) => STATUS_ORDER[a.thesisStatus] - STATUS_ORDER[b.thesisStatus],
    );
    // DAR-122: 종목당 1카드(데이터 레벨 중복 보조 방어선) — 상태 우선순위가 높은 행을 대표로 보존.
    return dedupeByStock(sorted, (p) => p.id);
  }, [positionsQuery.data]);

  const filteredPositions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const base = query
      ? sortedPositions.filter(
          (p) =>
            p.corpName.toLowerCase().includes(query) ||
            (p.ticker?.toLowerCase().includes(query) ?? false),
        )
      : sortedPositions;

    return [...base].sort((a, b) => {
      if (sortKey === 'pnl') {
        return a.pnlPercent - b.pnlPercent;
      }
      if (sortKey === 'weight') {
        return (b.weight ?? 0) - (a.weight ?? 0);
      }
      return (
        (STATUS_ORDER[a.thesisStatus] - STATUS_ORDER[b.thesisStatus]) ||
        ((b.exitScore ?? 0) - (a.exitScore ?? 0))
      );
    });
  }, [sortedPositions, searchQuery, sortKey]);

  const renderPosition = useCallback(
    ({ item }: { item: Position }) => <PositionCard position={item} onPress={handlePositionPress} />,
    [handlePositionPress],
  );

  // DAR-356: 접힘 토글 표시/카운트용 — TodayCheckSlot 큐레이션 조건과 동일 술어(점검 대상만 노출).
  const todayCheckCount = useMemo(() => {
    const data = positionsQuery.data ?? [];
    return data.filter(
      (p) =>
        p.exitScore !== undefined ||
        p.thesisStatus === 'VIOLATED' ||
        p.thesisStatus === 'EXPIRED',
    ).length;
  }, [positionsQuery.data]);

  const renderLive = () => {
    if (positionsQuery.isLoading) return <SkeletonList variant="buyScore" />;
    if (positionsQuery.isError) {
      return <ApiErrorState error={positionsQuery.error} title="포지션을 불러오지 못했습니다." onRetry={positionsQuery.refetch} />;
    }

    const summary = summaryQuery.data;
    const basisLabel = currentPortfolioBasisLabel();

    return (
      <View style={styles.liveBody}>
        {/* DAR-356: 검색/정렬은 요약과 리스트 사이에서 제거 → 헤더 상단 고정.
            스크롤로 사라지지 않고, 요약 글랜스 존을 밀어내지 않는다. 검색 대상이 있을 때만 노출. */}
        {(positionsQuery.data?.length ?? 0) > 0 ? (
          <View style={styles.fixedSearch}>
            <PositionSearchBar
              value={searchQuery}
              onChangeText={setSearchQuery}
              sortKey={sortKey}
              onSortChange={setSortKey}
            />
          </View>
        ) : null}
        <FlatList
          ref={listRef}
          data={filteredPositions}
          renderItem={renderPosition}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          removeClippedSubviews={false}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
          refreshing={positionsQuery.isRefetching}
          onRefresh={() => {
            positionsQuery.refetch();
            summaryQuery.refetch();
            riskQuery.refetch();
          }}
          ListHeaderComponent={
          <View style={styles.liveHeader}>
            {summary ? (
              <Surface elevation={1} style={[styles.summary, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                {/* DAR-356 GROUND-1: 총평가금액(대형) 1줄 + 손익 색조 1줄 = 2줄 헤드라인.
                    무스크롤 최상단에서 '내 상태 어때?'를 2초 내 글랜스로 파악. */}
                <View style={styles.summaryTopRow}>
                  <Text style={[typo.small, { color: colors.textSecondary }]}>총 평가금액</Text>
                  {/* DAR-356 GROUND-2: 신선도 정직 표기('기준: 실시간' | '기준: 장 마감'). */}
                  <Text style={[typo.small, { color: colors.textTertiary }]}>{basisLabel}</Text>
                </View>
                <Text
                  style={[typo.h1, styles.headlineValue, { color: colors.text }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >
                  {summary.totalValue.toLocaleString()}원
                </Text>
                <View style={styles.headlinePnlRow}>
                  <Feather
                    name={summary.totalPnlPercent < 0 ? 'trending-down' : 'trending-up'}
                    size={16}
                    color={pnlColor(summary.totalPnlPercent, colors)}
                  />
                  <Text style={[typo.bodyMedium, styles.headlinePnl, { color: pnlColor(summary.totalPnlPercent, colors) }]}>
                    {summary.totalPnl >= 0 ? '+' : ''}{summary.totalPnl.toLocaleString()}원 ({formatPnlPercent(summary.totalPnlPercent)})
                  </Text>
                </View>
                {/* DAR-163/356: 리스크 스냅샷(하드룰 위반 전폭 배너 우선 → 일손익·집중도 1줄). 없으면 미표시. */}
                <PortfolioRiskBadge snapshot={riskQuery.data} style={styles.riskBadge} />
                {summary.mddBreached ? (
                  <Banner visible actions={[]} style={[styles.banner, { backgroundColor: colors.surfaceSecondary }]}>
                    <Text style={[typo.small, { color: colors.error }]}>
                      포트폴리오 손실 한도 초과 위험 — 포지션 점검이 필요합니다.
                    </Text>
                  </Banner>
                ) : null}
              </Surface>
            ) : null}

            {/* DAR-356: '오늘 점검할 포지션'은 요약 아래 세컨더리 + 기본 접힘. 글랜스 존을 덮지 않는다. */}
            {todayCheckCount > 0 ? (
              <View>
                <TouchableOpacity
                  style={[styles.collapseToggle, { borderColor: colors.borderLight, backgroundColor: colors.surface }]}
                  onPress={() => setShowTodayCheck((v) => !v)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showTodayCheck }}
                  accessibilityLabel={`오늘 점검할 포지션 ${todayCheckCount}건 ${showTodayCheck ? '접기' : '펼치기'}`}
                >
                  <Feather name="check-circle" size={14} color={colors.textSecondary} />
                  <Text style={[typo.captionMedium, styles.collapseLabel, { color: colors.text }]}>
                    오늘 점검할 포지션 {todayCheckCount}건
                  </Text>
                  <Feather name={showTodayCheck ? 'chevron-up' : 'chevron-down'} size={16} color={colors.textSecondary} />
                </TouchableOpacity>
                {showTodayCheck ? (
                  <TodayCheckSlot positions={positionsQuery.data ?? []} onPress={handlePositionPress} />
                ) : null}
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          // DAR-212: 실전은 실제 주문 엔드포인트가 없어(Engine5 게이트) 항상 빈 상태일 수 있다.
          // 매수 유도 CTA 대신 '준비 중'을 정직하게 안내하고, 지금 쓸 수 있는 '내 모의'로 보낸다.
          pickLiveEmptyState(positionsQuery.data?.length ?? 0) === 'preparing' ? (
            <EmptyState
              icon="clock"
              title="실전 거래는 준비 중이에요"
              description="실제 주문 기능은 아직 제공되지 않아요. 지금은 '내 모의' 탭에서 전략을 미리 확인해 보세요."
              actionLabel="내 모의 보기"
              onAction={() => setSubTab('paper')}
            />
          ) : (
            <EmptyState
              icon="search"
              title="검색 결과가 없어요"
              actionLabel="초기화"
              onAction={() => setSearchQuery('')}
            />
          )
        }
        />
      </View>
    );
  };

  const renderPaper = () => {
    if (paperQuery.isLoading) return <SkeletonList variant="buyScore" />;
    if (paperQuery.isError) {
      return <ApiErrorState error={paperQuery.error} title="모의투자 정보를 불러오지 못했습니다." onRetry={paperQuery.refetch} />;
    }

    const paper = paperQuery.data;

    return (
      <FlatList
        ref={listRef}
        data={paper?.positions ?? []}
        renderItem={renderPosition}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={false}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        refreshing={paperQuery.isRefetching}
        onRefresh={paperQuery.refetch}
        ListHeaderComponent={
          <View style={styles.paperHeader}>
            <Banner visible actions={[]} icon="information" style={[styles.banner, { backgroundColor: colors.surfaceSecondary }]}>
              <Text style={[typo.small, { color: colors.info }]}>
                모의투자 중 — 실제 돈이 투입되지 않습니다.
              </Text>
            </Banner>
            {paper?.started ? (
              <Surface elevation={1} style={[styles.summary, { backgroundColor: colors.surface, borderColor: colors.border }]}>
                <Text style={[typo.small, { color: colors.textSecondary }]}>가상 총자산</Text>
                <Text style={[typo.h2, { color: colors.text, marginTop: spacing.xs }]}>
                  {paper.totalAsset.toLocaleString()}원
                </Text>
                <Text style={[typo.captionMedium, { color: pnlColor(paper.totalPnlPercent, colors), marginTop: spacing.xs }]}>
                  {paper.totalPnl.toLocaleString()}원 ({formatPnlPercent(paper.totalPnlPercent)})
                </Text>
                {typeof paper.signalHitRate === 'number' ? (
                  <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.sm }]}>
                    신호 적중률 {Math.round(paper.signalHitRate * 100)}%
                  </Text>
                ) : null}
              </Surface>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          paper?.started ? (
            <EmptyState {...emptyStateCopy.paperTradingNoSignalsEmpty} />
          ) : (
            <EmptyState
              {...emptyStateCopy.paperTradingEmpty}
              description="신호 탭에서 매수 신호를 확인하면 AI 기반 가상 주문이 채워져요"
              onAction={() => router.push('/(tabs)/signals')}
            />
          )
        }
      />
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[typo.h2, { color: colors.text }]}>포트폴리오</Text>
      </View>

      {/* DAR-113: 포트폴리오는 전 탭 인증 필요(401). 게스트는 탭/빈·에러 화면 대신 로그인 유도. */}
      {!isAuthenticated ? (
        <GuestPrompt
          {...guestPromptCopy.portfolio}
          secondaryLabel="공시 먼저 둘러보기"
          onSecondary={() => router.push('/(tabs)/home')}
        />
      ) : (
        <>
          {/* DAR-212: 5분할 SegmentedButtons는 역할 라벨이 잘려(개념 과밀) 가로 스크롤 칩 행으로
              노출한다(DAR-156 종목상세 패턴 재사용). '내 모의'/'시스템 모의'로 주체를 구분. */}
          <View style={styles.tabs}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.tabScrollContent}
            >
              {PORTFOLIO_TABS.map((tab) => {
                const isActive = subTab === tab.value;
                return (
                  <TouchableOpacity
                    key={tab.value}
                    style={[
                      styles.tabChip,
                      isActive
                        ? { backgroundColor: colors.primary, borderColor: colors.primary }
                        : { backgroundColor: colors.surface, borderColor: colors.borderLight },
                    ]}
                    onPress={() => setSubTab(tab.value)}
                    activeOpacity={0.7}
                    hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: isActive }}
                    accessibilityLabel={tab.a11y}
                  >
                    <Text
                      numberOfLines={1}
                      maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
                      style={[
                        typo.captionMedium,
                        { color: isActive ? colors.primaryForeground : colors.textSecondary },
                      ]}
                    >
                      {tab.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>

          <View style={styles.body}>
            {subTab === 'live'
              ? renderLive()
              : subTab === 'paper'
                ? renderPaper()
                : subTab === 'sim'
                  ? <SimulationStatusSection />
                  : subTab === 'persona'
                    ? <PersonaTrackSection />
                    : <StyleComparisonSection />}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  tabs: {
    paddingTop: spacing.md,
  },
  tabScrollContent: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  tabChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    borderWidth: 1,
    minHeight: 36,
  },
  body: {
    flex: 1,
  },
  liveBody: {
    flex: 1,
  },
  fixedSearch: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
    flexGrow: 1,
  },
  liveHeader: {
    gap: spacing.md,
    marginBottom: spacing.sm,
  },
  summary: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
  summaryTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headlineValue: {
    marginTop: spacing.xs,
  },
  headlinePnlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  headlinePnl: {
    fontWeight: '700',
  },
  riskBadge: {
    marginTop: spacing.md,
  },
  collapseToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    minHeight: 44,
  },
  collapseLabel: {
    flex: 1,
  },
  paperHeader: {
    gap: spacing.md,
  },
  banner: {
    borderRadius: radius.md,
  },
});
