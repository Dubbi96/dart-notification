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
import { GlassCard } from '@components/common/GlassCard';
import { EmptyState, ApiErrorState } from '@components/common/StateView';
import { emptyStateCopy } from '@components/common/emptyStateCopy';
import { SkeletonList } from '@components/common/SkeletonCard';
import { HomeSignalPreview } from '@components/home/HomeSignalPreview';
import { GraduationTracker } from '@components/home/GraduationTracker';
import { FirstWatchCoachmark } from '@components/home/FirstWatchCoachmark';
import { DisclosureFeedCard } from '@components/home/DisclosureFeedCard';
import { AppRefreshControl } from '@components/common/AppRefreshControl';
import { SearchOverlay } from '@components/common/SearchOverlay';
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

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { colors, typography: typo } = useTheme();
  const { isAuthenticated, requireAuth } = useRequireAuth();
  const userName = useAuthStore((s) => s.user?.name);

  const { data: watchlistData } = useWatchlist({ enabled: isAuthenticated });
  const watchlistCount = watchlistData?.meta?.total ?? 0;

  const hasWatchlist = isAuthenticated && watchlistCount > 0;
  const [feedTab, setFeedTab] = useState<'all' | 'watchlist'>(hasWatchlist ? 'watchlist' : 'all');
  const isWatchlistFeed = feedTab === 'watchlist';

  // 홈 헤더 검색 직결(§10) — 1탭 진입. 비로그인은 기존 인증 게이트 유지.
  const [searchVisible, setSearchVisible] = useState(false);
  const handleSearchOpen = () => {
    if (!requireAuth()) return;
    setSearchVisible(true);
  };

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

  const { data: savedData } = useSavedDisclosures({ enabled: isAuthenticated });
  const savedCount = savedData?.data?.length ?? 0;

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

  if (isLoading) {
    // 공시 피드 스켈레톤(§2-1)
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={{ paddingTop: insets.top }}>
          <SkeletonList variant="disclosure" />
        </View>
      </View>
    );
  }

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
              accessibilityLabel="기업 검색"
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
              accessibilityLabel={`오늘의 공시 ${totalCount}건, 공시 목록 열기`}
            >
              <Text style={[typo.h2, { color: '#FFFFFF' }]}>{totalCount}</Text>
              <Text style={[typo.small, { color: 'rgba(255,255,255,0.8)' }]}>오늘의 공시</Text>
            </TouchableOpacity>
            <View style={[styles.summaryDivider, { backgroundColor: 'rgba(255,255,255,0.25)' }]} />
            <TouchableOpacity style={styles.summaryItem} onPress={() => {
              if (requireAuth()) router.push('/settings-detail/watchlist');
            }}>
              <Text style={[typo.h2, { color: '#FFFFFF' }]}>{isAuthenticated ? watchlistCount : '-'}</Text>
              <Text style={[typo.small, { color: 'rgba(255,255,255,0.8)' }]}>관심 기업</Text>
            </TouchableOpacity>
            <View style={[styles.summaryDivider, { backgroundColor: 'rgba(255,255,255,0.25)' }]} />
            <TouchableOpacity style={styles.summaryItem} onPress={() => {
              if (requireAuth()) router.push('/settings-detail/saved-disclosures');
            }}>
              <Text style={[typo.h2, { color: '#FFFFFF' }]}>{isAuthenticated ? savedCount : '-'}</Text>
              <Text style={[typo.small, { color: 'rgba(255,255,255,0.8)' }]}>저장된 공시</Text>
            </TouchableOpacity>
          </View>
        </GlassCard>
      </LinearGradient>

      {/* Content area with top border radius */}
      <View style={[styles.contentArea, { backgroundColor: colors.background }]}>
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
            >
              <Text
                style={[
                  typo.captionMedium,
                  { color: feedTab === 'all' ? '#FFFFFF' : colors.textSecondary },
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
              >
                <Ionicons
                  name="star"
                  size={12}
                  color={feedTab === 'watchlist' ? '#FFFFFF' : colors.textSecondary}
                  style={{ marginRight: 4 }}
                />
                <Text
                  style={[
                    typo.captionMedium,
                    { color: feedTab === 'watchlist' ? '#FFFFFF' : colors.textSecondary },
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

        <FlatList
          data={disclosures}
          renderItem={renderDisclosureItem}
          keyExtractor={keyExtractor}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
          removeClippedSubviews
          onEndReached={handleEndReached}
          onEndReachedThreshold={0.5}
          refreshControl={
            <AppRefreshControl refreshing={isRefetching && !isFetchingNextPage} onRefresh={refetch} />
          }
          ListFooterComponent={
            isFetchingNextPage ? (
              <ActivityIndicator style={{ paddingVertical: spacing.lg }} color={colors.primary} />
            ) : null
          }
          ListEmptyComponent={
            // 연결 실패 시 빈 상태("기업 검색") 대신 사유+재시도를 노출(DAR-43 §1).
            isError ? (
              <ApiErrorState
                error={error}
                onRetry={refetch}
                title="공시를 불러오지 못했습니다"
              />
            ) : (
              <EmptyState
                {...emptyStateCopy.homeDisclosureEmpty}
                actionLabel="기업 검색"
                onAction={handleSearchOpen}
              />
            )
          }
        />
      </View>

      {/* 검색 오버레이(§10) — 1탭 진입 */}
      <SearchOverlay visible={searchVisible} onClose={() => setSearchVisible(false)} />
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
