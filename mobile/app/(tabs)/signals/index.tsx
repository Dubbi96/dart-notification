import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SegmentedButtons } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { ExitScoreCard } from '@components/signals/ExitScoreCard';
import { SignalExplorer } from '@components/signals/SignalExplorer';
import { CurationSlot } from '@components/signals/CurationSlot';
import { SignalSearchInput } from '@components/signals/SignalSearchInput';
import { DisclaimerSection } from '@components/common/DisclaimerSection';
import { EmptyState, ApiErrorState } from '@components/common/StateView';
import { GuestPrompt } from '@components/common/GuestPrompt';
import { emptyStateCopy } from '@components/common/emptyStateCopy';
import { guestPromptCopy } from '@components/common/guestPromptCopy';
import { SkeletonList } from '@components/common/SkeletonCard';
import { useAuthStore } from '@stores/authStore';
import { useExitSignals } from '@hooks/useSignals';

import type { ExitSignal } from '@app-types/signal.types';

type FeedTab = 'buy' | 'sell';

export default function SignalsScreen() {
  const { colors, typography: typo } = useTheme();
  const [feedTab, setFeedTab] = useState<FeedTab>('buy');
  const [search, setSearch] = useState('');
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

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

  // 매수 탐색 화면 상단(L1 큐레이션 → L2 검색 → 피드 입구 토글 → 메타 배너).
  // SegmentedButtons는 큐레이션·검색 아래 위계로 하향(§3-b).
  const buyHeader = (
    <View>
      {/* L1: 오늘 주목할 신호 큐레이션(§3-a) — 최상단 1순위 */}
      <CurationSlot onExplore={handleExplore} />

      {/* L2: 종목 검색(§3-b) */}
      <SignalSearchInput value={search} onChangeText={setSearch} />

      {/* 전체 피드 입구(매수/매도) — 위계 하향 */}
      <View style={styles.feedToggle}>
        <SegmentedButtons
          value={feedTab}
          onValueChange={(v) => setFeedTab(v as FeedTab)}
          buttons={[
            { value: 'buy', label: '매수 탐색', icon: 'trending-up' },
            { value: 'sell', label: '매도', icon: 'trending-down' },
          ]}
        />
      </View>

      {/* 메타 배너(투자거장·이벤트통계) — 추천보다 아래 위계 */}
      {metaBanners}

      <View style={styles.sectionLabel}>
        <Text style={[typo.captionMedium, { color: colors.textSecondary }]}>전체 신호 탐색</Text>
      </View>
    </View>
  );

  // 매도 피드도 큐레이션·검색·토글을 상단에 유지해 동선 일관성 확보.
  const sellHeader = (
    <View>
      <CurationSlot onExplore={handleExplore} />
      <SignalSearchInput value={search} onChangeText={setSearch} />
      <View style={styles.feedToggle}>
        <SegmentedButtons
          value={feedTab}
          onValueChange={(v) => setFeedTab(v as FeedTab)}
          buttons={[
            { value: 'buy', label: '매수 탐색', icon: 'trending-up' },
            { value: 'sell', label: '매도', icon: 'trending-down' },
          ]}
        />
      </View>
      <View style={styles.sectionLabel}>
        <Text style={[typo.captionMedium, { color: colors.textSecondary }]}>전체 매도 신호</Text>
      </View>
    </View>
  );

  const renderBody = () => {
    // DAR-113: 매수·매도 신호는 인증 필요(401). 게스트는 빈/에러 화면 대신 로그인 유도.
    if (!isAuthenticated) {
      return (
        <GuestPrompt
          {...guestPromptCopy.signals}
          secondaryLabel="공시 먼저 둘러보기"
          onSecondary={() => router.push('/(tabs)/home')}
        />
      );
    }

    if (feedTab === 'buy') {
      // L2 SignalExplorer가 단일 스크롤 컨테이너. 상단 슬롯은 ListHeaderComponent로 주입.
      return <SignalExplorer searchQuery={search} ListHeaderComponent={buyHeader} />;
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
        style={styles.body}
        data={data}
        renderItem={renderExit}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={false}
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
