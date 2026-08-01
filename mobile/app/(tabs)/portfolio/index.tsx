import React, { useCallback, useMemo, useRef } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router, useScrollToTop } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

import { GuestPrompt } from '@components/common/GuestPrompt';
import { ApiErrorState, EmptyState } from '@components/common/StateView';
import { SkeletonList } from '@components/common/SkeletonCard';
import { withTradingGuard } from '@components/common/withTradingGuard';
import { PortfolioRiskBadge } from '@components/portfolio/PortfolioRiskBadge';
import { PositionCard } from '@components/portfolio/PositionCard';
import { usePortfolioRisk, usePortfolioSummary, usePositions } from '@hooks/usePortfolio';
import { useAuthStore } from '@stores/authStore';
import { useTheme } from '@theme';
import { radius, spacing } from '@theme/spacing';
import { dedupeByStock } from '@utils/dedupe';
import { guestPromptCopy } from '@components/common/guestPromptCopy';
import { formatPnlPercent, pnlColor } from '@utils/signalDisplay';

import type { Position } from '@app-types/portfolio.types';

const STATUS_ORDER: Record<Position['thesisStatus'], number> = {
  VIOLATED: 0,
  EXPIRED: 1,
  WATCHING: 2,
  ACTIVE: 3,
};

function signedKrw(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : ''}${rounded.toLocaleString('ko-KR')}원`;
}

/** AOS 모바일 포트폴리오는 보유 상태와 Risk만 보여준다. 비교·백테스트·모의운영은 Admin 소관이다. */
function PortfolioScreen() {
  const { colors, typography: typo } = useTheme();
  const authenticated = useAuthStore((state) => state.isAuthenticated);
  const positions = usePositions({ enabled: authenticated });
  const summary = usePortfolioSummary({ enabled: authenticated });
  const risk = usePortfolioRisk({ enabled: authenticated });
  const listRef = useRef<FlatList<Position>>(null);
  useScrollToTop(listRef);

  const rows = useMemo(() => {
    const sorted = [...(positions.data ?? [])].sort(
      (left, right) =>
        STATUS_ORDER[left.thesisStatus] - STATUS_ORDER[right.thesisStatus] ||
        (right.exitScore ?? 0) - (left.exitScore ?? 0),
    );
    return dedupeByStock(sorted, (position) => position.id);
  }, [positions.data]);

  const refresh = useCallback(() => {
    void Promise.all([positions.refetch(), summary.refetch(), risk.refetch()]);
  }, [positions, risk, summary]);

  const renderPosition = useCallback(
    ({ item }: { item: Position }) => (
      <PositionCard
        position={item}
        onPress={(position) =>
          router.push(`/portfolio/${position.portfolioId}/position/${position.id}`)
        }
      />
    ),
    [],
  );

  if (!authenticated) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <Header />
        <GuestPrompt
          {...guestPromptCopy.portfolio}
          secondaryLabel="오늘의 판단 보기"
          onSecondary={() => router.push('/(tabs)/signals')}
        />
      </SafeAreaView>
    );
  }

  if (positions.isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <Header />
        <SkeletonList variant="buyScore" />
      </SafeAreaView>
    );
  }

  if (positions.isError) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
        <Header />
        <ApiErrorState
          error={positions.error}
          title="포지션을 불러오지 못했습니다."
          onRetry={refresh}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <Header />
      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(item) => item.id}
        renderItem={renderPosition}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
        refreshing={positions.isRefetching || summary.isRefetching || risk.isRefetching}
        onRefresh={refresh}
        ListHeaderComponent={
          <View style={styles.headerStack}>
            <View
              style={[
                styles.summaryCard,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={styles.summaryTitleRow}>
                <View style={styles.flex}>
                  <Text style={[typo.small, { color: colors.textSecondary }]}>시스템 자금과 분리된 보유</Text>
                  <Text
                    style={[typo.h1, styles.amount, { color: colors.text }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.7}
                  >
                    {summary.data ? `${summary.data.totalValue.toLocaleString('ko-KR')}원` : '—'}
                  </Text>
                </View>
                <Feather name="briefcase" size={24} color={colors.primary} />
              </View>
              {summary.data ? (
                <Text
                  style={[
                    typo.bodyMedium,
                    { color: pnlColor(summary.data.totalPnlPercent, colors) },
                  ]}
                >
                  {signedKrw(summary.data.totalPnl)} ({formatPnlPercent(summary.data.totalPnlPercent)})
                </Text>
              ) : (
                <Text style={[typo.small, { color: colors.textSecondary }]}>
                  평가 요약을 확인할 수 없습니다.
                </Text>
              )}
              <Text style={[typo.small, styles.basis, { color: colors.textTertiary }]}>
                조회 전용 · 실주문 기능 없음
              </Text>
            </View>

            {risk.data ? (
              <PortfolioRiskBadge snapshot={risk.data} />
            ) : risk.isError ? (
              <View style={[styles.inlineNotice, { backgroundColor: colors.warningSurface }]}>
                <Feather name="alert-triangle" size={16} color={colors.warning} />
                <Text style={[typo.small, styles.flex, { color: colors.text }]}>Risk 상태를 확인할 수 없습니다.</Text>
              </View>
            ) : null}

            <View style={styles.sectionTitleRow}>
              <Text style={[typo.h3, { color: colors.text }]}>보유 포지션</Text>
              <Text style={[typo.small, { color: colors.textSecondary }]}>{rows.length}건</Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          <EmptyState
            icon="briefcase"
            title="보유 포지션이 없습니다"
            description="Rule과 Risk를 통과한 포지션이 생기면 이곳에서 상태와 중단 기준을 확인할 수 있어요."
          />
        }
      />
    </SafeAreaView>
  );

  function Header() {
    return (
      <View style={[styles.screenHeader, { borderBottomColor: colors.border }]}>
        <Text style={[typo.h2, { color: colors.text }]}>포지션</Text>
        <Text style={[typo.small, { color: colors.textSecondary }]}>보유 · 손익 · Risk 상태</Text>
      </View>
    );
  }
}

export default withTradingGuard(PortfolioScreen);

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1, minWidth: 0 },
  screenHeader: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    flexGrow: 1,
  },
  headerStack: { gap: spacing.md, marginBottom: spacing.sm },
  summaryCard: { borderRadius: radius.lg, borderWidth: 1, padding: spacing.base },
  summaryTitleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  amount: { marginTop: spacing.xs, flexShrink: 1 },
  basis: { marginTop: spacing.sm },
  inlineNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
});
