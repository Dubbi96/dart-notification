import React, { useMemo, useState } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { MoonStars, Sun, CloudSun, Moon } from 'phosphor-react-native';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { palette } from '@theme/colors';
import { spacing, radius } from '@theme/spacing';
import { Card } from '@components/common/Card';
import { GlassCard } from '@components/common/GlassCard';
import { EmptyState, ApiErrorState } from '@components/common/StateView';
import { emptyStateCopy } from '@components/common/emptyStateCopy';
import { SkeletonList } from '@components/common/SkeletonCard';
import { AppRefreshControl } from '@components/common/AppRefreshControl';
import { SearchOverlay } from '@components/common/SearchOverlay';
import { useDisclosures } from '@hooks/useDisclosures';
import { useWatchlist } from '@hooks/useWatchlist';
import { useSavedDisclosures } from '@hooks/useSavedDisclosures';
import { useNotifications } from '@hooks/useNotifications';
import { useRequireAuth } from '@hooks/useRequireAuth';
import { useAuthStore } from '@stores/authStore';
import { getTypeStyle, getTypeLabel } from '@utils/disclosureType';
import { parse, format } from 'date-fns';

function getGreeting(): { text: string; Icon: typeof Sun } {
  const hour = new Date().getHours();

  if (hour < 6) return { text: '오늘도 늦게까지 고생 많으시네요', Icon: MoonStars };
  if (hour < 12) return { text: '좋은 아침이에요', Icon: Sun };
  if (hour < 18) return { text: '기분 좋은 오후예요', Icon: CloudSun };
  return { text: '편안한 밤 보내세요', Icon: Moon };
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { colors, typography: typo, isDark } = useTheme();
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

  const renderDisclosureItem = ({ item }: { item: any }) => (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => router.push(`/disclosure/${item.rcpNo}`)}
    >
      <Card style={styles.disclosureCard} variant="elevated">
        <View style={styles.disclosureHeader}>
          <View
            style={[
              styles.typeBadge,
              { backgroundColor: getTypeStyle(item.disclosureType, isDark).bg },
            ]}
          >
            <Text
              style={[
                typo.small,
                { color: getTypeStyle(item.disclosureType, isDark).text, fontWeight: '600' },
              ]}
            >
              {getTypeLabel(item.disclosureType)}
            </Text>
          </View>
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            {format(parse(item.rcpDt, 'yyyyMMdd', new Date()), 'yyyy.MM.dd')}
          </Text>
        </View>
        <Text style={[typo.bodyMedium, { color: colors.text, marginTop: spacing.sm }]} numberOfLines={2}>
          {item.reportName}
        </Text>
        <Text style={[typo.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>
          {item.corpName}
        </Text>
      </Card>
    </TouchableOpacity>
  );

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
            <TouchableOpacity style={styles.summaryItem} onPress={() => router.push('/disclosures')}>
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
          <TouchableOpacity onPress={() => router.push(
            isWatchlistFeed
              ? { pathname: '/disclosures', params: { watchlistOnly: 'true' } }
              : '/disclosures'
          )}>
            <Text style={[typo.captionMedium, { color: colors.primary }]}>전체보기</Text>
          </TouchableOpacity>
        </View>

        {/* 관심기업 등록 유도 배너 */}
        {isAuthenticated && watchlistCount === 0 && (
          <TouchableOpacity
            style={[styles.guideBanner, { backgroundColor: colors.primaryLight }]}
            onPress={handleSearchOpen}
            activeOpacity={0.7}
          >
            <Ionicons name="star-outline" size={16} color={colors.primary} />
            <Text style={[typo.caption, { color: colors.primary, flex: 1, marginLeft: spacing.sm }]}>
              {emptyStateCopy.homeWatchlistEmpty.title}
            </Text>
            <Ionicons name="chevron-forward" size={14} color={colors.primary} />
          </TouchableOpacity>
        )}

        <FlatList
          data={disclosures}
          renderItem={renderDisclosureItem}
          keyExtractor={(item) => item.rcpNo}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onEndReached={() => {
            if (hasNextPage && !isFetchingNextPage) {
              fetchNextPage();
            }
          }}
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
  guideBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
  },
  listContent: {
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  disclosureCard: {
    marginBottom: 0,
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
  disclosureHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  typeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
});
