import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons, Feather } from '@expo/vector-icons';
import { MoonStars, Sun, CloudSun, Moon } from 'phosphor-react-native';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { palette } from '@theme/colors';
import { spacing, radius } from '@theme/spacing';
import { typography } from '@theme/typography';
import { verticalHitSlopForHeight } from '@utils/touchTarget';
import { GlassCard } from '@components/common/GlassCard';
import { EmptyState, ApiErrorState } from '@components/common/StateView';
import { emptyStateCopy } from '@components/common/emptyStateCopy';
import { SkeletonList } from '@components/common/SkeletonCard';
import { HomeSignalPreview } from '@components/home/HomeSignalPreview';
import { GraduationTracker } from '@components/home/GraduationTracker';
import { FirstWatchCoachmark } from '@components/home/FirstWatchCoachmark';
import { DisclosureFeedCard } from '@components/home/DisclosureFeedCard';
import { useDisclosures } from '@hooks/useDisclosures';
import { useWatchlist } from '@hooks/useWatchlist';
import { useSavedDisclosures } from '@hooks/useSavedDisclosures';
import { useNotifications } from '@hooks/useNotifications';
import { useRequireAuth } from '@hooks/useRequireAuth';
import { useAuthStore } from '@stores/authStore';

import type { Disclosure } from '@app-types/disclosure.types';

function getGreeting(): { text: string; Icon: typeof Sun } {
  const hour = new Date().getHours();

  if (hour < 6) return { text: '오늘도 늦게까지 고생 많으시네요', Icon: MoonStars };
  if (hour < 12) return { text: '좋은 아침이에요', Icon: Sun };
  if (hour < 18) return { text: '기분 좋은 오후예요', Icon: CloudSun };
  return { text: '편안한 밤 보내세요', Icon: Moon };
}

// 세그먼트 탭 실효 시각 높이 = paddingVertical(spacing.sm 상·하) + 라벨 lineHeight.
// 시각 크기는 유지하고 유효 터치 영역만 44pt로 확장한다(접근성, DAR-146).
const SEGMENT_TAB_VISUAL_HEIGHT = spacing.sm * 2 + typography.captionMedium.lineHeight;
const SEGMENT_TAB_HIT_SLOP = verticalHitSlopForHeight(SEGMENT_TAB_VISUAL_HEIGHT);

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { colors, typography: typo } = useTheme();
  const { isAuthenticated, requireAuth } = useRequireAuth();
  const userName = useAuthStore((s) => s.user?.name);

  const {
    data: watchlistData,
    isLoading: watchlistLoading,
    isError: watchlistError,
  } = useWatchlist({ enabled: isAuthenticated });
  const watchlistCount = watchlistData?.meta?.total ?? 0;

  const hasWatchlist = isAuthenticated && watchlistCount > 0;
  const [feedTab, setFeedTab] = useState<'all' | 'watchlist'>(hasWatchlist ? 'watchlist' : 'all');
  const isWatchlistFeed = feedTab === 'watchlist';

  // 홈 헤더 검색 직결(§10) — 1탭 진입. 통합 검색(기업+공시)은 읽기전용 탐색이라 게스트도 접근 가능(DAR-164).
  const handleSearchOpen = useCallback(() => {
    router.push('/search');
  }, []);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
    isRefetching,
    refetch,
  } = useDisclosures(undefined, isWatchlistFeed);

  const disclosures = useMemo(() => {
    const all = data?.pages.flatMap((page) => page.data) ?? [];
    const seen = new Set<string>();
    return all.filter((item) => {
      if (seen.has(item.rcpNo)) return false;
      seen.add(item.rcpNo);
      return true;
    });
  }, [data]);

  const totalCount = data?.pages[0]?.meta.total ?? 0;

  const {
    data: savedData,
    isLoading: savedLoading,
    isError: savedError,
  } = useSavedDisclosures({ enabled: isAuthenticated });
  const savedCount = savedData?.data?.length ?? 0;

  // DAR-108(#10): 로딩/에러 시 수치를 '—'로 표기해 '0건' 오인을 방지한다.
  // 비로그인은 로딩이 아니라 인증 게이트이므로 기존 '-' 표기를 유지한다.
  const EM_DASH = '—';
  const disclosuresCountDisplay = isLoading || isError ? EM_DASH : String(totalCount);
  const watchlistCountDisplay = !isAuthenticated
    ? '-'
    : watchlistLoading || watchlistError
      ? EM_DASH
      : String(watchlistCount);
  const savedCountDisplay = !isAuthenticated
    ? '-'
    : savedLoading || savedError
      ? EM_DASH
      : String(savedCount);

  const { data: notifData } = useNotifications({ enabled: isAuthenticated });
  const unreadCount = notifData?.pages[0]?.meta.unreadCount ?? 0;

  // DAR-107: 가상화 콜백 안정화(인라인 함수 제거). 카드는 React.memo(DisclosureFeedCard).
  const renderDisclosureItem = useCallback(
    ({ item }: { item: Disclosure }) => <DisclosureFeedCard item={item} />,
    [],
  );
  const keyExtractor = useCallback((item: Disclosure) => item.rcpNo, []);
  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  // DAR-114: 졸업 트래커가 잘리고 스크롤되지 않던 문제 수정.
  // 기존엔 HomeSignalPreview/GraduationTracker/sectionHeader/코치마크가 FlatList 바깥
  // 고정 형제로 배치돼 화면 하단에서 잘렸다. 이를 FlatList의 ListHeaderComponent로 옮겨
  // 화면 전체가 단일 FlatList로 스크롤되게 한다(ScrollView 금지 규칙 준수).
  // listContent의 paddingHorizontal(spacing.lg)이 헤더에도 적용되므로, 헤더는 자체 가로
  // 마진을 가진 컴포넌트(카드/카루셀)들로 구성되어 있어 음수 마진 래퍼로 이중 패딩을 상쇄한다.
  const ListHeader = useCallback(
    () => (
      <View style={styles.listHeader}>
        {/* 오늘의 투자판단 프리뷰(DAR-61) — summaryCard 아래 최상단. 공시→투자판단 1순위 동선. */}
        <HomeSignalPreview isAuthenticated={isAuthenticated} />

        {/* 졸업 트래커(DAR-67) — Main Thesis B 결승선(M10) 게이트 진척. 단일 시스템 모의 포트폴리오라 게스트 데모 가능. */}
        <GraduationTracker />

        {/* Disclosures */}
        <View style={styles.sectionHeader}>
          <View style={styles.segmentControl}>
            <TouchableOpacity
              style={[
                styles.segmentTab,
                feedTab === 'all'
                  ? { backgroundColor: colors.primary }
                  : { backgroundColor: colors.surface, borderColor: colors.borderLight, borderWidth: 1 },
              ]}
              onPress={() => setFeedTab('all')}
              activeOpacity={0.7}
              hitSlop={SEGMENT_TAB_HIT_SLOP}
            >
              <Text
                style={[
                  typo.captionMedium,
                  { color: feedTab === 'all' ? colors.primaryForeground : colors.textSecondary },
                ]}
              >
                전체 공시
              </Text>
            </TouchableOpacity>
            {hasWatchlist && (
              <TouchableOpacity
                style={[
                  styles.segmentTab,
                  feedTab === 'watchlist'
                    ? { backgroundColor: colors.primary }
                    : { backgroundColor: colors.surface, borderColor: colors.borderLight, borderWidth: 1 },
                ]}
                onPress={() => setFeedTab('watchlist')}
                activeOpacity={0.7}
                hitSlop={SEGMENT_TAB_HIT_SLOP}
              >
                <Ionicons
                  name="star"
                  size={12}
                  color={feedTab === 'watchlist' ? colors.primaryForeground : colors.textSecondary}
                  style={{ marginRight: 4 }}
                />
                <Text
                  style={[
                    typo.captionMedium,
                    { color: feedTab === 'watchlist' ? colors.primaryForeground : colors.textSecondary },
                  ]}
                >
                  관심 기업
                </Text>
              </TouchableOpacity>
            )}
          </View>
          {/* DAR-106: 공시 목록(13종 이벤트 필터) 발견성 승격 — 명확한 라벨·Feather 아이콘 진입 버튼. */}
          <TouchableOpacity
            style={[styles.browseButton, { backgroundColor: colors.surface, borderColor: colors.borderLight }]}
            onPress={() => router.push(
              isWatchlistFeed
                ? { pathname: '/disclosures', params: { watchlistOnly: 'true' } }
                : '/disclosures'
            )}
            activeOpacity={0.7}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel={isWatchlistFeed ? '관심 기업 공시 전체보기 (필터)' : '공시 전체보기 (필터)'}
          >
            <Feather name="sliders" size={13} color={colors.primary} style={{ marginRight: 4 }} />
            <Text style={[typo.captionMedium, { color: colors.primary }]}>전체보기</Text>
          </TouchableOpacity>
        </View>

        {/* 첫 관심기업 코치마크(DAR-65) — 관심목록 비었을 때 1회성·dismiss 가능. 수집 시드 등록 유도. */}
        {isAuthenticated && watchlistCount === 0 && (
          <FirstWatchCoachmark onAdd={handleSearchOpen} />
        )}
      </View>
    ),
    [
      isAuthenticated,
      feedTab,
      hasWatchlist,
      isWatchlistFeed,
      watchlistCount,
      colors,
      typo,
      handleSearchOpen,
    ],
  );

  const ListEmpty = useCallback(
    () =>
      isLoading ? (
        // DAR-108(#10): 헤더는 유지한 채 피드 영역만 스켈레톤으로 채운다.
        <SkeletonList variant="disclosure" />
      ) : isError ? (
        // 연결 실패 시 빈 상태("기업 검색") 대신 사유+재시도를 노출(DAR-43 §1).
        <ApiErrorState error={error} onRetry={refetch} title="공시를 불러오지 못했습니다" />
      ) : (
        <EmptyState
          {...emptyStateCopy.homeDisclosureEmpty}
          actionLabel="기업 검색"
          onAction={handleSearchOpen}
        />
      ),
    [isLoading, isError, error, refetch, handleSearchOpen],
  );

  // DAR-108(#10): 초기 로딩 시에도 헤더 셸을 유지하고 콘텐츠(피드)만 스켈레톤으로
  // 대체해 레이아웃 점프를 방지한다. (기존: 화면 전체를 스켈레톤으로 대체 → 헤더가 뒤늦게 등장)
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header - Paychain style gradient header */}
      <LinearGradient
        colors={[colors.cardGradientStart, colors.cardGradientEnd]}
        style={[styles.header, { paddingTop: insets.top + spacing.base }]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={styles.headerTop}>
          <View>
            <Text style={[typo.small, { color: 'rgba(255,255,255,0.5)' }]}>실시간 DART 공시 알리미</Text>
            <Text style={[typo.h2, { color: '#FFFFFF', marginTop: 2 }]}>{userName ? `${userName} 님` : '공시온'}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              {(() => { const { text, Icon } = getGreeting(); return (
                <>
                  <Text style={[typo.caption, { color: 'rgba(255,255,255,0.7)' }]}>{text}</Text>
                  <Icon size={16} color="rgba(255,255,255,0.7)" weight="duotone" />
                </>
              ); })()}
            </View>
          </View>
          <View style={styles.headerActions}>
            {/* 검색 1탭 진입(§10) */}
            <TouchableOpacity
              style={styles.headerIcon}
              onPress={handleSearchOpen}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityRole="button"
              accessibilityLabel="통합 검색"
            >
              <GlassCard intensity={20} variant="iridescent" style={styles.headerIconGlass}>
                <View style={styles.headerIconInner}>
                  <Ionicons name="search" size={22} color={palette.white} />
                </View>
              </GlassCard>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerIcon}
              onPress={() => {
                if (requireAuth()) router.push('/(tabs)/notifications');
              }}
              accessibilityRole="button"
              accessibilityLabel="알림"
            >
              <GlassCard intensity={20} variant="iridescent" style={styles.headerIconGlass}>
                <View style={styles.headerIconInner}>
                  <Ionicons name="notifications-outline" size={22} color={palette.white} />
                </View>
              </GlassCard>
              {unreadCount > 0 && (
                <View style={styles.notifBadge}>
                  <Text style={styles.notifBadgeText}>
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Summary card - Glassmorphism + Holographic iridescent */}
        <GlassCard style={styles.summaryCard} intensity={30} variant="iridescent">
          <View style={styles.summaryContent}>
            <TouchableOpacity
              style={styles.summaryItem}
              onPress={() => router.push('/disclosures')}
              accessibilityRole="button"
              accessibilityLabel={
                isLoading || isError
                  ? '오늘의 공시 집계 불러오는 중, 공시 목록 열기'
                  : `오늘의 공시 ${totalCount}건, 공시 목록 열기`
              }
            >
              <Text style={[typo.h2, { color: '#FFFFFF' }]}>{disclosuresCountDisplay}</Text>
              <Text style={[typo.small, { color: 'rgba(255,255,255,0.8)' }]}>오늘의 공시</Text>
            </TouchableOpacity>
            <View style={[styles.summaryDivider, { backgroundColor: 'rgba(255,255,255,0.25)' }]} />
            <TouchableOpacity style={styles.summaryItem} onPress={() => {
              if (requireAuth()) router.push('/settings-detail/watchlist');
            }}>
              <Text style={[typo.h2, { color: '#FFFFFF' }]}>{watchlistCountDisplay}</Text>
              <Text style={[typo.small, { color: 'rgba(255,255,255,0.8)' }]}>관심 기업</Text>
            </TouchableOpacity>
            <View style={[styles.summaryDivider, { backgroundColor: 'rgba(255,255,255,0.25)' }]} />
            <TouchableOpacity style={styles.summaryItem} onPress={() => {
              if (requireAuth()) router.push('/settings-detail/saved-disclosures');
            }}>
              <Text style={[typo.h2, { color: '#FFFFFF' }]}>{savedCountDisplay}</Text>
              <Text style={[typo.small, { color: 'rgba(255,255,255,0.8)' }]}>저장된 공시</Text>
            </TouchableOpacity>
          </View>
        </GlassCard>
      </LinearGradient>

      {/* Content area with top border radius — 화면 전체가 단일 FlatList로 스크롤(DAR-114). */}
      <View style={[styles.contentArea, { backgroundColor: colors.background }]}>
        <FlatList
          style={styles.feedList}
          // 로딩 중에는 data를 빈 배열로 둬 ListEmptyComponent(스켈레톤)가 뜨게 한다.
          data={isLoading ? [] : disclosures}
          renderItem={renderDisclosureItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
          // 헤더(졸업 트래커 등)의 터치/카루셀 인터랙션이 클리핑으로 깨지지 않도록 false.
          removeClippedSubviews={false}
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
          // DAR-114: refreshControl={<커스텀래퍼>}는 RN0.85 Fabric(Android)에서 FlatList 콘텐츠를
          // 통째로 미렌더시킨다. RN 권장인 refreshing/onRefresh props로 교체(Fabric 호환).
          refreshing={isRefetching && !isFetchingNextPage}
          onRefresh={refetch}
          ListHeaderComponent={ListHeader}
          ListFooterComponent={
            isFetchingNextPage ? (
              <ActivityIndicator style={{ paddingVertical: spacing.lg }} color={colors.primary} />
            ) : null
          }
          ListEmptyComponent={ListEmpty}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.base,
    paddingBottom: spacing.xl + radius.xl,
  },
  headerTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  headerIcon: {
    width: 44,
    height: 44,
  },
  headerIconGlass: {
    width: 44,
    height: 44,
    borderRadius: radius.xl,
  },
  headerIconInner: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: radius.xl,
  },
  summaryCard: {
    marginTop: spacing.lg,
  },
  summaryContent: {
    flexDirection: 'row',
    padding: spacing.base,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryDivider: {
    width: 1,
  },
  contentArea: {
    flex: 1,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    marginTop: -radius.xl,
  },
  // DAR-114: Android에서 FlatList가 부모(flex:1)를 못 채우고 높이 0으로 붕괴하는 문제 방지.
  feedList: {
    flex: 1,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    marginBottom: spacing.md,
  },
  segmentControl: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  segmentTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
  },
  browseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  listContent: {
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  // ListHeaderComponent는 listContent의 paddingHorizontal(spacing.lg)을 받는다.
  // 헤더 내부 컴포넌트(HomeSignalPreview 카루셀·GraduationTracker·sectionHeader)는
  // 자체 가로 마진/패딩(spacing.lg)과 전체 화면폭 기준 카드폭을 전제하므로,
  // 음수 가로 마진으로 컨테이너 패딩을 상쇄해 기존 정렬·여백을 그대로 유지한다.
  listHeader: {
    marginHorizontal: -spacing.lg,
  },
  notifBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#FF3B30',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  notifBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
});
