import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SegmentedButtons, Surface, Banner } from 'react-native-paper';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { PositionCard } from '@components/portfolio/PositionCard';
import { EmptyState, ApiErrorState } from '@components/common/StateView';
import { emptyStateCopy } from '@components/common/emptyStateCopy';
import { SkeletonList } from '@components/common/SkeletonCard';
import { AppRefreshControl } from '@components/common/AppRefreshControl';
import { SimulationStatusSection } from '@components/portfolio/SimulationStatusSection';
import { usePositions, usePortfolioSummary, usePaperPortfolio } from '@hooks/usePortfolio';
import { pnlColor, formatPnlPercent } from '@utils/signalDisplay';

import type { Position } from '@app-types/portfolio.types';

type SubTab = 'live' | 'paper' | 'sim';

// VIOLATED/EXPIRED 포지션을 리스트 최상단으로 고정하는 정렬 우선순위.
const STATUS_ORDER: Record<Position['thesisStatus'], number> = {
  VIOLATED: 0,
  EXPIRED: 1,
  WATCHING: 2,
  ACTIVE: 3,
};

export default function PortfolioScreen() {
  const { colors, typography: typo } = useTheme();
  const [subTab, setSubTab] = useState<SubTab>('live');

  const positionsQuery = usePositions();
  const summaryQuery = usePortfolioSummary();
  const paperQuery = usePaperPortfolio();

  const handlePositionPress = useCallback((position: Position) => {
    router.push(`/portfolio/${position.portfolioId}/position/${position.id}`);
  }, []);

  const sortedPositions = useMemo(() => {
    const data = positionsQuery.data ?? [];
    return [...data].sort((a, b) => STATUS_ORDER[a.thesisStatus] - STATUS_ORDER[b.thesisStatus]);
  }, [positionsQuery.data]);

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
        data={sortedPositions}
        renderItem={renderPosition}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <AppRefreshControl refreshing={positionsQuery.isRefetching} onRefresh={positionsQuery.refetch} />
        }
        ListHeaderComponent={
          summary ? (
            <Surface elevation={1} style={[styles.summary, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={[typo.small, { color: colors.textSecondary }]}>총 평가금액</Text>
              <Text style={[typo.h2, { color: colors.text, marginTop: spacing.xs }]}>
                {summary.totalValue.toLocaleString()}원
              </Text>
              <Text style={[typo.captionMedium, { color: pnlColor(summary.totalPnlPercent, colors), marginTop: spacing.xs }]}>
                {summary.totalPnl.toLocaleString()}원 ({formatPnlPercent(summary.totalPnlPercent)})
              </Text>
              {summary.mddBreached ? (
                <Banner visible actions={[]} style={[styles.banner, { backgroundColor: colors.surfaceSecondary }]}>
                  <Text style={[typo.small, { color: colors.error }]}>
                    포트폴리오 손실 한도 초과 위험 — 포지션 점검이 필요합니다.
                  </Text>
                </Banner>
              ) : null}
            </Surface>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            {...emptyStateCopy.portfolioEmpty}
            onAction={() => router.push('/(tabs)/signals')}
          />
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
        data={paper?.positions ?? []}
        renderItem={renderPosition}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <AppRefreshControl refreshing={paperQuery.isRefetching} onRefresh={paperQuery.refetch} />
        }
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
            <EmptyState icon="activity" title="아직 실행된 모의투자 신호가 없습니다." />
          ) : (
            <EmptyState {...emptyStateCopy.paperTradingEmpty} />
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

      <View style={styles.tabs}>
        <SegmentedButtons
          value={subTab}
          onValueChange={(v) => setSubTab(v as SubTab)}
          buttons={[
            { value: 'live', label: '실전', icon: 'wallet' },
            { value: 'paper', label: '모의', icon: 'flask' },
            { value: 'sim', label: '모의운용', icon: 'chart-line' },
          ]}
        />
      </View>

      <View style={styles.body}>
        {subTab === 'live' ? renderLive() : subTab === 'paper' ? renderPaper() : <SimulationStatusSection />}
      </View>
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
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  body: {
    flex: 1,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
    flexGrow: 1,
  },
  summary: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
  paperHeader: {
    gap: spacing.md,
  },
  banner: {
    borderRadius: radius.md,
  },
});
