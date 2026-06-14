import React, { useState, useCallback, useMemo, useRef } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SegmentedButtons } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router, useScrollToTop } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { ExitScoreCard } from '@components/signals/ExitScoreCard';
import { SignalExplorer } from '@components/signals/SignalExplorer';
import { CurationSlot } from '@components/signals/CurationSlot';
import { SignalSearchInput } from '@components/signals/SignalSearchInput';
import { DisclaimerSection } from '@components/common/DisclaimerSection';
import { EmptyState, ApiErrorState } from '@components/common/StateView';
import { GuestSignalPreview } from '@components/signals/GuestSignalPreview';
import { emptyStateCopy } from '@components/common/emptyStateCopy';
import { SkeletonList } from '@components/common/SkeletonCard';
import { useAuthStore } from '@stores/authStore';
import { useExitSignals } from '@hooks/useSignals';

import type { ExitSignal, TradingSignal } from '@app-types/signal.types';

type FeedTab = 'buy' | 'sell';

export default function SignalsScreen() {
  const { colors, typography: typo } = useTheme();
  const [feedTab, setFeedTab] = useState<FeedTab>('buy');
  const [search, setSearch] = useState('');
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // DAR-181: 탭 재탭 시 최상단 복귀. 매수(SignalExplorer)·매도 FlatList는 상호배타로
  // 동시에 하나만 마운트되므로 비활성 ref는 null → useScrollToTop이 no-op.
  const buyListRef = useRef<FlatList<TradingSignal>>(null);
  const sellListRef = useRef<FlatList<ExitSignal>>(null);
  useScrollToTop(buyListRef);
  useScrollToTop(sellListRef);

  const exitQuery = useExitSignals();

  const handleExitPress = useCallback((signal: ExitSignal) => {
    router.push(`/signals/${signal.id}`);
  }, []);

  const renderExit = useCallback(
    ({ item }: { item: ExitSignal }) => <ExitScoreCard signal={item} onPress={handleExitPress} />,
    [handleExitPress],
  );

  // 추천 0건일 때 큐레이션 슬롯 CTA → 매수(탐색) 피드로 전환해 L2 점수순 탐색 유도.
  const handleExplore = useCallback(() => {
    setFeedTab('buy');
  }, []);

  // DAR-227: SegmentedButtons onValueChange를 안정 참조로 고정(매 렌더 새 함수 금지).
  const handleFeedTabChange = useCallback((v: string) => {
    setFeedTab(v as FeedTab);
  }, []);

  // 상단 진입점 배너(투자거장·이벤트통계) — 추천 슬롯보다 아래 위계(§3-d). 위험 없으면 추천을 밀어내지 않음.
  const metaBanners = useMemo(
    () => (
      <View style={styles.metaBanners}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => router.push('/philosophy')}
          accessibilityRole="button"
          accessibilityLabel="투자거장 철학 보기 — 버핏·린치·그린블라트·드러켄밀러"
          style={[styles.metaBanner, { backgroundColor: colors.primaryLight, borderColor: colors.border }]}
        >
          <Feather name="award" size={18} color={colors.primary} />
          <View style={styles.metaBannerText}>
            <Text style={[typo.bodyMedium, { color: colors.text }]}>투자거장</Text>
            <Text style={[typo.small, { color: colors.textSecondary }]}>4종 철학으로 종목 적합도 보기</Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.textTertiary} />
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => router.push('/event-stats')}
          accessibilityRole="button"
          accessibilityLabel="이벤트 통계 보기 — 공시 유형별 시장 평균 초과수익·표본·승률"
          style={[styles.metaBanner, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
        >
          <Feather name="bar-chart-2" size={18} color={colors.primary} />
          <View style={styles.metaBannerText}>
            <Text style={[typo.bodyMedium, { color: colors.text }]}>이벤트 통계</Text>
            <Text style={[typo.small, { color: colors.textSecondary }]}>
              공시 유형별 시장 평균 초과수익·표본·승률
            </Text>
          </View>
          <Feather name="chevron-right" size={18} color={colors.textTertiary} />
        </TouchableOpacity>
      </View>
    ),
    [colors, typo],
  );

  // DAR-227: 헤더 서브트리를 조각별로 메모이즈해 타이핑(search 변경)에도 참조 동일성 유지.
  // 검색 입력만 search에 의존해 리렌더하고, CurationSlot·SegmentedButtons는 동일 엘리먼트
  // 참조라 React가 재조정을 건너뛴다(매 렌더 헤더 변수 재생성으로 인한 서브트리 리렌더 제거).
  const curationSlot = useMemo(() => <CurationSlot onExplore={handleExplore} />, [handleExplore]);

  const searchInput = useMemo(
    () => <SignalSearchInput value={search} onChangeText={setSearch} />,
    [search],
  );

  // 전체 피드 입구(매수/매도) — feedTab에만 의존(search 무관)해 타이핑 시 리렌더 0.
  const feedToggle = useMemo(
    () => (
      <View style={styles.feedToggle}>
        <SegmentedButtons
          value={feedTab}
          onValueChange={handleFeedTabChange}
          buttons={[
            { value: 'buy', label: '매수 탐색', icon: 'trending-up' },
            { value: 'sell', label: '매도', icon: 'trending-down' },
          ]}
        />
      </View>
    ),
    [feedTab, handleFeedTabChange],
  );

  // 매수 탐색 화면 상단(L1 큐레이션 → L2 검색 → 피드 입구 토글 → 메타 배너).
  // SegmentedButtons는 큐레이션·검색 아래 위계로 하향(§3-b).
  const buyHeader = useMemo(
    () => (
      <View>
        {/* L1: 오늘 주목할 신호 큐레이션(§3-a) — 최상단 1순위 */}
        {curationSlot}

        {/* L2: 종목 검색(§3-b) */}
        {searchInput}

        {/* 전체 피드 입구(매수/매도) — 위계 하향 */}
        {feedToggle}

        {/* 메타 배너(투자거장·이벤트통계) — 추천보다 아래 위계 */}
        {metaBanners}

        <View style={styles.sectionLabel}>
          <Text style={[typo.captionMedium, { color: colors.textSecondary }]}>전체 신호 탐색</Text>
        </View>
      </View>
    ),
    [curationSlot, searchInput, feedToggle, metaBanners, typo, colors],
  );

  // 매도 피드도 큐레이션·검색·토글을 상단에 유지해 동선 일관성 확보.
  const sellHeader = useMemo(
    () => (
      <View>
        {curationSlot}
        {searchInput}
        {feedToggle}
        <View style={styles.sectionLabel}>
          <Text style={[typo.captionMedium, { color: colors.textSecondary }]}>전체 매도 신호</Text>
        </View>
      </View>
    ),
    [curationSlot, searchInput, feedToggle, typo, colors],
  );

  const renderBody = () => {
    // DAR-113/DAR-213: 매수·매도 신호는 인증 필요(401). 게스트는 빈/에러 화면 대신
    // read-only 미리보기(블러+잠금 카드) + 로그인 CTA로 가치를 직접 맛보게 한다.
    if (!isAuthenticated) {
      return (
        <GuestSignalPreview
          secondaryLabel="공시 먼저 둘러보기"
          onSecondary={() => router.push('/(tabs)/home')}
        />
      );
    }

    if (feedTab === 'buy') {
      // L2 SignalExplorer가 단일 스크롤 컨테이너. 상단 슬롯은 ListHeaderComponent로 주입.
      return <SignalExplorer searchQuery={search} ListHeaderComponent={buyHeader} listRef={buyListRef} />;
    }

    // 매도 피드 — 큐레이션·검색 아래의 전체 매도 신호. 토글로 진입.
    if (exitQuery.isLoading) {
      return (
        <View style={styles.body}>
          {sellHeader}
          <SkeletonList variant="buyScore" />
        </View>
      );
    }
    if (exitQuery.isError) {
      return (
        <View style={styles.body}>
          {sellHeader}
          <ApiErrorState
            error={exitQuery.error}
            title="매도 신호를 불러오지 못했습니다."
            description="잠시 후 다시 시도해 주세요."
            onRetry={exitQuery.refetch}
          />
        </View>
      );
    }
    const data = exitQuery.data ?? [];
    return (
      <FlatList
        ref={sellListRef}
        style={styles.body}
        data={data}
        renderItem={renderExit}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={false}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        refreshing={exitQuery.isRefetching}
        onRefresh={exitQuery.refetch}
        ListHeaderComponent={sellHeader}
        ListEmptyComponent={<EmptyState {...emptyStateCopy.exitSignalsEmpty} />}
        ListFooterComponent={data.length > 0 ? <DisclaimerSection style={styles.disclaimer} /> : null}
      />
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[typo.h2, { color: colors.text }]}>신호</Text>
      </View>
      {renderBody()}
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
  body: {
    flex: 1,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
    flexGrow: 1,
  },
  disclaimer: {
    marginTop: spacing.lg,
  },
  feedToggle: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  sectionLabel: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  metaBanners: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  metaBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  metaBannerText: {
    flex: 1,
  },
});
