import React, { useState, useCallback, useMemo, useRef } from 'react';
import { View, Text, FlatList, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Surface, Banner } from 'react-native-paper';
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

  const renderLive = () => {
    if (positionsQuery.isLoading) return <SkeletonList variant="buyScore" />;
    if (positionsQuery.isError) {
      return <ApiErrorState error={positionsQuery.error} title="포지션을 불러오지 못했습니다." onRetry={positionsQuery.refetch} />;
    }

    const summary = summaryQuery.data;

    return (
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
                <Text style={[typo.small, { color: colors.textSecondary }]}>총 평가금액</Text>
                <Text style={[typo.h2, { color: colors.text, marginTop: spacing.xs }]}>
                  {summary.totalValue.toLocaleString()}원
                </Text>
                <Text style={[typo.captionMedium, { color: pnlColor(summary.totalPnlPercent, colors), marginTop: spacing.xs }]}>
                  {summary.totalPnl.toLocaleString()}원 ({formatPnlPercent(summary.totalPnlPercent)})
                </Text>
                {/* DAR-163: 최신 리스크 스냅샷(일손익·집중도·하드룰 위반). 데이터 없으면 미표시. */}
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
            <TodayCheckSlot positions={positionsQuery.data ?? []} onPress={handlePositionPress} />
            <PositionSearchBar
              value={searchQuery}
              onChangeText={setSearchQuery}
              sortKey={sortKey}
              onSortChange={setSortKey}
            />
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
  riskBadge: {
    marginTop: spacing.sm,
  },
  paperHeader: {
    gap: spacing.md,
  },
  banner: {
    borderRadius: radius.md,
  },
});
