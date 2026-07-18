import React, { useState, useCallback, useMemo, useRef } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SegmentedButtons } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { router, useScrollToTop, useLocalSearchParams } from 'expo-router';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { ExitScoreCard } from '@components/signals/ExitScoreCard';
import { SignalExplorer } from '@components/signals/SignalExplorer';
import { BuyEditionView } from '@components/signals/BuyEditionView';
import { SignalSearchInput } from '@components/signals/SignalSearchInput';
import { SignalsCoachmark } from '@components/signals/SignalsCoachmark';
import { DisclaimerSection } from '@components/common/DisclaimerSection';
import { EmptyState, ApiErrorState } from '@components/common/StateView';
import { GuestSignalPreview } from '@components/signals/GuestSignalPreview';
import { emptyStateCopy } from '@components/common/emptyStateCopy';
import { SkeletonList } from '@components/common/SkeletonCard';
import { useAuthStore } from '@stores/authStore';
import { useExitSignals } from '@hooks/useSignals';
import { usePositions } from '@hooks/usePortfolio';
import { SIGNALS_HEADER_SUBTITLE } from '@utils/copy';
import { SHOW_TRADING } from '@utils/tradingVisibility';

import type { ExitSignal, TradingSignal } from '@app-types/signal.types';

type FeedTab = 'buy' | 'sell';
// DAR-509: 매수 뷰 2모드 — 'edition'(뉴스형 에디션 브라우징, 기본) / 'archive'(무한스크롤 탐색, 보조).
type BuyMode = 'edition' | 'archive';

export default function SignalsScreen() {
  const { colors, typography: typo } = useTheme();
  // DAR-527: 에디션 발행 딥링크(`/signals?date=YYYYMMDD`) 진입 — 해당 호로 직행한다.
  const { date: dateParam } = useLocalSearchParams<{ date?: string }>();
  const editionDate =
    typeof dateParam === 'string' && /^\d{8}$/.test(dateParam) ? dateParam : undefined;
  const [feedTab, setFeedTab] = useState<FeedTab>('buy');
  const [buyMode, setBuyMode] = useState<BuyMode>('edition');
  const [search, setSearch] = useState('');
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // 에디션 딥링크(`?date=…`)로 진입하면 매수·에디션 모드로 고정(다른 탭/모드에 있었어도 해당 호 노출).
  //   렌더 단계에서 직전 파라미터와 비교해 동기화(React 권장 'derive-from-props' 패턴 — useEffect+
  //   setState 의 추가 커밋/캐스케이드 렌더 회피, 포트폴리오 `?tab=` 동일 사상). 유효 날짜가 새로
  //   올 때만 반응해 사용자의 수동 탭 전환을 덮어쓰지 않는다(파라미터 부재·불변=무동작).
  const [seenEditionDate, setSeenEditionDate] = useState(editionDate);
  if (editionDate !== seenEditionDate) {
    setSeenEditionDate(editionDate);
    if (editionDate) {
      setFeedTab('buy');
      setBuyMode('edition');
    }
  }

  // DAR-181: 탭 재탭 시 최상단 복귀. 매수(에디션 리스트 또는 SignalExplorer)·매도 FlatList는
  // 상호배타로 동시에 하나만 마운트되므로 비활성 ref는 null → useScrollToTop이 no-op.
  const buyListRef = useRef<FlatList<TradingSignal>>(null);
  const sellListRef = useRef<FlatList<ExitSignal>>(null);
  useScrollToTop(buyListRef);
  useScrollToTop(sellListRef);

  const exitQuery = useExitSignals();

  // UXR(B-9): 매도 빈 상태가 보유 포지션 0건·평가 미실행에도 '모든 포지션이 안전'을 단정하던
  // 문제 — 포지션 유무로 빈 상태 카피를 분기한다. 매도 탭 활성 시에만 발화(enabled 게이팅).
  const positionsQuery = usePositions({ enabled: isAuthenticated && feedTab === 'sell' });
  const hasNoPositions = positionsQuery.isSuccess && (positionsQuery.data?.length ?? 0) === 0;

  // UXR-3(B-2): 매도 검색 — corpName/ticker 클라이언트 필터(서버 키워드 검색 미존재).
  const trimmedQuery = search.trim().toLowerCase();
  const isSearching = trimmedQuery.length > 0;
  const exitItems = useMemo(() => {
    const all = exitQuery.data ?? [];
    if (!trimmedQuery) return all;
    return all.filter(
      (item) =>
        item.corpName.toLowerCase().includes(trimmedQuery) ||
        (item.ticker?.toLowerCase().includes(trimmedQuery) ?? false),
    );
  }, [exitQuery.data, trimmedQuery]);

  const handleClearSearch = useCallback(() => setSearch(''), []);

  // 매도 빈 상태(보유 0건) CTA — 매수 에디션 브라우징으로 전환해 후보 탐색 유도.
  const handleExplore = useCallback(() => {
    setFeedTab('buy');
    setBuyMode('edition');
  }, []);

  // DAR-310: 매도 신호는 corpCode로 기업 허브(위험 배지·신호·공시·통계)로 보낸다.
  const handleExitPress = useCallback((signal: ExitSignal) => {
    router.push(`/company/${signal.corpCode}`);
  }, []);

  const renderExit = useCallback(
    ({ item }: { item: ExitSignal }) => <ExitScoreCard signal={item} onPress={handleExitPress} />,
    [handleExitPress],
  );

  // DAR-227: SegmentedButtons onValueChange를 안정 참조로 고정(매 렌더 새 함수 금지).
  const handleFeedTabChange = useCallback((v: string) => setFeedTab(v as FeedTab), []);

  // 매도 pull-to-refresh — exit 피드 재조회.
  const refetchExit = exitQuery.refetch;
  const handleSellRefresh = useCallback(() => {
    refetchExit();
  }, [refetchExit]);

  // 종목 검색 입력 — 아카이브(explore)·매도 필터에 연동. search에만 의존.
  const searchInput = useMemo(
    () => <SignalSearchInput value={search} onChangeText={setSearch} />,
    [search],
  );

  // 진입점 배너(투자거장·이벤트통계) — 아카이브(탐색) 헤더에 배치. 정체 시에도 추천을 밀어내지 않음.
  const metaBanners = useMemo(
    () => (
      <View style={styles.metaBanners}>
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => router.push('/philosophy')}
          accessibilityRole="button"
          accessibilityLabel="투자거장 철학 보기 — 버핏·린치·그린블라트·드러켄밀러"
          style={[styles.metaBanner, { backgroundColor: colors.surfaceSecondary, borderColor: colors.border }]}
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

  // 아카이브(explore) 상단 헤더 — 검색 + 진입 배너. SignalExplorer가 필터/정렬 헤더를 이어 붙인다.
  const archiveHeader = useMemo(
    () => (
      <View>
        {searchInput}
        {metaBanners}
      </View>
    ),
    [searchInput, metaBanners],
  );

  // 매도 상단 헤더 — 검색 + 섹션 라벨(매수/매도 토글은 화면 상단 고정 위치로 분리).
  const sellHeader = useMemo(
    () => (
      <View>
        {searchInput}
        <View style={styles.sectionLabel}>
          <Text style={[typo.captionMedium, { color: colors.textSecondary }]}>전체 매도 신호</Text>
        </View>
      </View>
    ),
    [searchInput, typo, colors],
  );

  // 매수/매도 토글 — 화면 상단 고정(스크롤 무관 상시 노출).
  const feedToggle = (
    <View style={styles.feedToggle}>
      <SegmentedButtons
        value={feedTab}
        onValueChange={handleFeedTabChange}
        buttons={[
          { value: 'buy', label: '매수', icon: 'trending-up' },
          { value: 'sell', label: '매도', icon: 'trending-down' },
        ]}
      />
    </View>
  );

  // 매수 뷰 서브 토글 — 에디션(기본)/아카이브(보조). 매수/매도 토글보다 시각 위계 낮은 pill.
  const buyModeToggle = (
    <View style={styles.modeToggle}>
      {(['edition', 'archive'] as BuyMode[]).map((mode) => {
        const active = buyMode === mode;
        const label = mode === 'edition' ? '에디션' : '아카이브';
        const icon = mode === 'edition' ? 'book-open' : 'archive';
        return (
          <TouchableOpacity
            key={mode}
            onPress={() => setBuyMode(mode)}
            activeOpacity={0.7}
            style={[
              styles.modePill,
              active
                ? { backgroundColor: colors.primaryLight, borderColor: colors.primary }
                : { backgroundColor: colors.surface, borderColor: colors.borderLight },
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${label}${active ? ', 선택됨' : ''}`}
          >
            <Feather name={icon} size={13} color={active ? colors.primaryDark : colors.textSecondary} />
            <Text
              maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
              style={[
                typo.small,
                { color: active ? colors.primaryDark : colors.textSecondary, fontWeight: active ? '600' : '400' },
              ]}
            >
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  const renderBody = () => {
    // DAR-113/DAR-213: 매수·매도 신호는 인증 필요(401). 게스트는 read-only 미리보기 + 로그인 CTA.
    if (!isAuthenticated) {
      return (
        <GuestSignalPreview
          secondaryLabel="공시 먼저 둘러보기"
          onSecondary={() => router.push('/(tabs)/home')}
        />
      );
    }

    if (feedTab === 'buy') {
      return (
        <View style={styles.body}>
          {buyModeToggle}
          {buyMode === 'edition' ? (
            // 기본: 뉴스형 에디션 브라우징(고정 날짜 스트립 + 선택일 세로 리스트).
            // DAR-527: 에디션 딥링크 진입 시 focusDate 로 해당 호 직행.
            <BuyEditionView listRef={buyListRef} focusDate={editionDate} />
          ) : (
            // 보조: 무한스크롤 아카이브 탐색(교차일 — 모든 카드 SignalDateBadge). 검색·필터 유지.
            <SignalExplorer
              searchQuery={search}
              ListHeaderComponent={archiveHeader}
              listRef={buyListRef}
            />
          )}
        </View>
      );
    }

    // 매도 피드 — 전체 매도 신호.
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
    // UXR-3(B-2): 검색 중 매칭 0건(원본 존재)이면 검색 전용 빈 상태로 분기.
    const isSearchEmpty = isSearching && exitItems.length === 0 && (exitQuery.data?.length ?? 0) > 0;
    return (
      <FlatList
        ref={sellListRef}
        style={styles.body}
        data={exitItems}
        renderItem={renderExit}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        removeClippedSubviews={false}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={7}
        refreshing={exitQuery.isRefetching}
        onRefresh={handleSellRefresh}
        ListHeaderComponent={sellHeader}
        ListEmptyComponent={
          isSearchEmpty ? (
            <EmptyState
              icon="search"
              title="검색 조건에 맞는 매도 신호가 없어요"
              description="종목명·티커를 확인하거나 다른 검색어로 시도해 보세요"
              actionLabel="검색어 지우기"
              onAction={handleClearSearch}
            />
          ) : hasNoPositions ? (
            <EmptyState {...emptyStateCopy.exitSignalsNoPositions} onAction={handleExplore} />
          ) : (
            <EmptyState {...emptyStateCopy.exitSignalsEmpty} />
          )
        }
        ListFooterComponent={exitItems.length > 0 ? <DisclaimerSection style={styles.disclaimer} /> : null}
      />
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <Text style={[typo.h2, { color: colors.text }]}>신호</Text>
        {/* UXR-3(W1-B13): 탭 정체 1줄 안내 — '참고' 어휘로 과신 금지(utils/copy.ts 톤). */}
        <Text style={[typo.small, styles.headerSubtitle, { color: colors.textSecondary }]}>
          {SIGNALS_HEADER_SUBTITLE}
        </Text>
      </View>
      {/* 신호 탭 첫 진입 코치마크 — 게스트는 미리보기 상태라 미노출(1회성 소모 방지). */}
      {isAuthenticated && <SignalsCoachmark />}
      {/* 매수/매도 토글 — 화면 상단 고정(에디션 스트립·리스트와 제스처 축 분리). */}
      {/* DAR-558/D4: Play 빌드는 포트폴리오 표면이 없어 매도=상시 빈 탭 — 토글 자체를 숨겨 매수 단독 렌더. */}
      {isAuthenticated && SHOW_TRADING && feedToggle}
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
  headerSubtitle: {
    marginTop: spacing.xs,
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
  modeToggle: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
  },
  modePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    minHeight: 32,
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
