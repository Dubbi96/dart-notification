import React, { useCallback, useMemo, useRef, useState } from 'react';
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
import { router, useScrollToTop } from 'expo-router';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { palette } from '@theme/colors';
import { spacing, radius } from '@theme/spacing';
import { typography } from '@theme/typography';
import { verticalHitSlopForHeight } from '@utils/touchTarget';
import { formatUnreadBadge } from '@utils/unreadBadge';
import { GlassCard } from '@components/common/GlassCard';
import { EmptyState, ApiErrorState } from '@components/common/StateView';
import { emptyStateCopy } from '@components/common/emptyStateCopy';
import { SkeletonList } from '@components/common/SkeletonCard';
import { HomeSignalPreview } from '@components/home/HomeSignalPreview';
import { MarketIndexBadge } from '@components/home/MarketIndexBadge';
import { GraduationTracker } from '@components/home/GraduationTracker';
import { FirstWatchCoachmark } from '@components/home/FirstWatchCoachmark';
import { DisclosureFeedCard } from '@components/home/DisclosureFeedCard';
import { useDisclosures, useTodayDisclosureCount } from '@hooks/useDisclosures';
import { useWatchlist } from '@hooks/useWatchlist';
import { useSavedDisclosures } from '@hooks/useSavedDisclosures';
import { useUnreadCount } from '@hooks/useNotifications';
import { useRequireAuth } from '@hooks/useRequireAuth';
import { useMe } from '@hooks/useAuth';

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
  // 서버 User SSOT = useMe().data (authStore 복제 제거, DAR-262). 미인증 시 쿼리 비활성→undefined.
  const userName = useMe().data?.name;

  // DAR-181: 같은 탭 재탭 시 피드 최상단 복귀(iOS 표준 인터랙션). RN Navigation useScrollToTop.
  const listRef = useRef<FlatList<Disclosure>>(null);
  useScrollToTop(listRef);

  const {
    data: watchlistData,
    isLoading: watchlistLoading,
    isError: watchlistError,
  } = useWatchlist({ enabled: isAuthenticated });
  const watchlistCount = watchlistData?.meta?.total ?? 0;

  const hasWatchlist = isAuthenticated && watchlistCount > 0;
  // UXR-10(A-4): 기본 탭을 파생(derived)으로 계산. 기존 useState 초기값은 첫 렌더 1회만
  //   평가되는데 그 시점엔 watchlist 쿼리가 로딩 중(count=0)이라 관심기업 보유자도 항상
  //   '전체 공시'로 진입했다. 사용자가 수동 전환(override)하기 전에는 관심기업 보유 시
  //   'watchlist'를 기본으로 하고, 관심기업 0개면 'all'로 강제해 stale 'watchlist' 상태
  //   (관심기업 전부 삭제 후 빈 관심 피드 표시)를 차단한다.
  const [feedTabOverride, setFeedTabOverride] = useState<'all' | 'watchlist' | null>(null);
  const feedTab: 'all' | 'watchlist' = hasWatchlist ? (feedTabOverride ?? 'watchlist') : 'all';
  const isWatchlistFeed = feedTab === 'watchlist';

  const selectAllTab = useCallback(() => setFeedTabOverride('all'), []);
  const selectWatchlistTab = useCallback(() => setFeedTabOverride('watchlist'), []);

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

  // DAR-420: 전체 누적(meta.total=137만)이 아니라 최신 가용 공시일 건수.
  //   별도 today-count 쿼리로 분리(피드 무한쿼리의 total과 무관).
  // DAR-422: 라벨을 '오늘의 공시'→'최신 공시'로 변경. DART 데이터 최신일(예: 06/19)이
  //   달력 today(예: 06/23)보다 뒤처질 수 있어 '오늘' 표현이 오해를 유발했음. '최신'은
  //   데이터 소스 지연을 자연스럽게 전달하고, 옆 날짜칩(MM/DD)이 기준일을 명시한다.
  const {
    data: todayCountData,
    isLoading: todayCountLoading,
    isError: todayCountError,
  } = useTodayDisclosureCount();
  const todayCount = todayCountData?.count ?? 0;
  // 최신 가용일 라벨(MM/DD) — env 시계와 데이터 괴리 투명화. 날짜 미상이면 생략.
  const todayDateLabel =
    todayCountData?.date && todayCountData.date.length === 8
      ? `${todayCountData.date.slice(4, 6)}/${todayCountData.date.slice(6, 8)}`
      : null;

  const {
    data: savedData,
    isLoading: savedLoading,
    isError: savedError,
  } = useSavedDisclosures({ enabled: isAuthenticated });
  const savedCount = savedData?.data?.length ?? 0;

  // DAR-108(#10): 로딩/에러 시 수치를 '—'로 표기해 '0건' 오인을 방지한다.
  // 비로그인은 로딩이 아니라 인증 게이트이므로 기존 '-' 표기를 유지한다.
  const EM_DASH = '—';
  const disclosuresCountDisplay =
    todayCountLoading || todayCountError ? EM_DASH : String(todayCount);
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

  // DAR-216: 탭 배지와 동일한 단일원천(useUnreadCount)을 구독 → 두 배지가 항상 일치.
  const { data: unreadCount = 0 } = useUnreadCount({ enabled: isAuthenticated });
  const unreadBadge = formatUnreadBadge(unreadCount);

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
  // UXR-10(A-3): 컴포넌트 함수(useCallback)가 아니라 useMemo 엘리먼트로 전달한다.
  //   함수형이면 deps(feedTab 등) 변경 시 함수 정체성이 바뀌어 React가 다른 컴포넌트 타입으로
  //   간주 → 헤더 서브트리(시장배지·신호 캐러셀·코치마크)를 통째로 unmount/remount했다
  //   (세그먼트 토글마다 캐러셀 스크롤 초기화·스켈레톤 재시작). 엘리먼트는 루트 타입(View)이
  //   고정이라 리렌더만 일어난다. ListEmpty/ListFooter 도 동일 패턴으로 고정.
  const listHeaderElement = useMemo(
    () => (
      <View style={styles.listHeader}>
        {/* 시장 한눈에 배지(DAR-160) — KOSPI·KOSDAQ 최신 지수·전일대비 등락률. 데이터 없으면 미표시. */}
        <MarketIndexBadge />

        {/* 오늘의 투자판단 프리뷰(DAR-61) — summaryCard 아래 최상단. 공시→투자판단 1순위 동선. */}
        <HomeSignalPreview isAuthenticated={isAuthenticated} />

        {/* DAR-446(A-HOME-2): 헤더 섹션을 시장배지·신호프리뷰·세그먼트 3개로 축소.
            '운용 성과'(GraduationTracker+퍼널)는 핵심 콘텐츠(공시 피드)를 묻지 않도록 피드 아래
            ListFooter 로 강등하고, 게스트에겐 모의운용 측정값을 노출하지 않는다(A-HOME-3). */}

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
              onPress={selectAllTab}
              activeOpacity={0.7}
              hitSlop={SEGMENT_TAB_HIT_SLOP}
              // UXR-10(S-A-3): 선택 상태가 색 단독이던 세그먼트에 role/state 부여
              //   (trade-history.tsx TabBar 정본 패턴 이식) — 스크린리더가 탭·선택 여부 안내.
              accessibilityRole="tab"
              accessibilityState={{ selected: feedTab === 'all' }}
            >
              <Text
                style={[
                  typo.captionMedium,
                  { color: feedTab === 'all' ? colors.primaryForeground : colors.textSecondary },
                ]}
                // DAR-305: 큰 글꼴서 세그먼트 라벨 단어 중간 줄바꿈·행 오버플로 방지(한 줄 보장 + 보조 캡).
                numberOfLines={1}
                maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
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
                onPress={selectWatchlistTab}
                activeOpacity={0.7}
                hitSlop={SEGMENT_TAB_HIT_SLOP}
                accessibilityRole="tab"
                accessibilityState={{ selected: feedTab === 'watchlist' }}
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
                  // DAR-305: 큰 글꼴서 세그먼트 라벨 단어 중간 줄바꿈·행 오버플로 방지(한 줄 보장 + 보조 캡).
                  numberOfLines={1}
                  maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
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
            {/* DAR-305: '전체보기' 액션 라벨 — 큰 글꼴서 단어 중간 줄바꿈 방지(한 줄 보장 + 보조 캡). */}
            <Text style={[typo.captionMedium, { color: colors.primary }]} numberOfLines={1} maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}>
              전체보기
            </Text>
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
      selectAllTab,
      selectWatchlistTab,
    ],
  );

  const listEmptyElement = useMemo(
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

  // DAR-446(A-HOME-2/3): '운용 성과'(졸업 트래커+전환 현황)를 핵심 공시 피드 아래(footer)로
  //   강등해 첫인상에서 피드가 묻히지 않게 한다. 로그인 사용자에게만 노출 — 게스트에겐 모의운용
  //   누적 측정값을 보여주지 않는다(인증 게이트). 기존 페이지네이션 스피너는 그대로 유지한다.
  const listFooterElement = useMemo(
    () => (
      <>
        {isAuthenticated ? (
          <View style={styles.listFooterSection}>
            <GraduationTracker />
          </View>
        ) : null}
        {isFetchingNextPage ? (
          <ActivityIndicator style={{ paddingVertical: spacing.lg }} color={colors.primary} />
        ) : null}
      </>
    ),
    [isAuthenticated, isFetchingNextPage, colors.primary],
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
            <Text style={[typo.small, { color: colors.onColorFaint }]}>실시간 DART 공시 알리미</Text>
            <Text style={[typo.h2, { color: colors.onColor, marginTop: 2 }]}>{userName ? `${userName} 님` : '공시온'}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
              {(() => { const { text, Icon } = getGreeting(); return (
                <>
                  <Text style={[typo.caption, { color: colors.onColorSubtle }]}>{text}</Text>
                  <Icon size={16} color={colors.onColorSubtle} weight="duotone" />
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
              {unreadBadge && (
                <View style={[styles.notifBadge, { backgroundColor: colors.error }]}>
                  {/* DAR-305: 고정 원형 배지 — OS 글꼴 확대 시 숫자 세로 클리핑 방지 배율 상한(DAR-174 정본). */}
                  <Text style={styles.notifBadgeText} maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}>
                    {unreadBadge}
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
                todayCountLoading || todayCountError
                  ? '최신 공시 집계 불러오는 중, 공시 목록 열기'
                  : `최신 공시${todayDateLabel ? ` ${todayDateLabel} 기준` : ''} ${todayCount}건, 공시 목록 열기`
              }
            >
              {/* DAR-446(A-HOME-5): 핵심 수치를 amount 토큰으로 강조 — 이름(h2)보다 큰 위계. */}
              <Text style={[typo.amount, { color: colors.onColor }]}>{disclosuresCountDisplay}</Text>
              <Text style={[typo.small, { color: colors.onColorMuted }]}>
                {todayDateLabel ? `최신 공시 (${todayDateLabel})` : '최신 공시'}
              </Text>
            </TouchableOpacity>
            <View style={[styles.summaryDivider, { backgroundColor: colors.hairlineOnColor }]} />
            {/* DAR-446(A-HOME-4): 세 통계 모두 accessibilityRole/Label 부여(기존 1개만 있었음). */}
            <TouchableOpacity
              style={styles.summaryItem}
              onPress={() => {
                if (requireAuth()) router.push('/settings-detail/watchlist');
              }}
              accessibilityRole="button"
              accessibilityLabel={
                !isAuthenticated
                  ? '관심 기업 — 로그인하고 보기'
                  : watchlistLoading || watchlistError
                    ? '관심 기업 집계 불러오는 중, 관심 기업 목록 열기'
                    : `관심 기업 ${watchlistCount}개, 관심 기업 목록 열기`
              }
            >
              <Text style={[typo.amount, { color: colors.onColor }]}>{watchlistCountDisplay}</Text>
              <Text style={[typo.small, { color: colors.onColorMuted }]}>관심 기업</Text>
            </TouchableOpacity>
            <View style={[styles.summaryDivider, { backgroundColor: colors.hairlineOnColor }]} />
            <TouchableOpacity
              style={styles.summaryItem}
              onPress={() => {
                if (requireAuth()) router.push('/settings-detail/saved-disclosures');
              }}
              accessibilityRole="button"
              accessibilityLabel={
                !isAuthenticated
                  ? '보관함 — 로그인하고 보기'
                  : savedLoading || savedError
                    ? '저장한 공시 집계 불러오는 중, 보관함 열기'
                    : `저장한 공시 ${savedCount}건, 보관함 열기`
              }
            >
              <Text style={[typo.amount, { color: colors.onColor }]}>{savedCountDisplay}</Text>
              <Text style={[typo.small, { color: colors.onColorMuted }]}>보관함</Text>
            </TouchableOpacity>
          </View>
        </GlassCard>
      </LinearGradient>

      {/* Content area with top border radius — 화면 전체가 단일 FlatList로 스크롤(DAR-114). */}
      <View style={[styles.contentArea, { backgroundColor: colors.background }]}>
        <FlatList
          ref={listRef}
          style={styles.feedList}
          // W15 ②: Maestro 스모크 앵커 — 게스트 피드 렌더 검증용(런타임 동작 무영향).
          testID="home-feed-list"
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
          ListHeaderComponent={listHeaderElement}
          ListFooterComponent={listFooterElement}
          ListEmptyComponent={listEmptyElement}
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
    // DAR-305: 큰 글꼴서 행 넘침 시 좌측 세그먼트군이 먼저 양보(우측 '전체보기' 보호). 평시 불변(넘침 없으면 무효).
    flexShrink: 1,
    minWidth: 0,
  },
  segmentTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    // DAR-305: 세그먼트군 축소가 탭까지 전파되도록(라벨 numberOfLines 와 함께 말줄임). 평시 불변.
    flexShrink: 1,
    minWidth: 0,
  },
  browseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    borderWidth: 1,
    // DAR-305: '전체보기' 액션 버튼은 압축/밀림 금지(항상 노출).
    flexShrink: 0,
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
  // DAR-446: footer '운용 성과' 섹션도 헤더와 동일하게 listContent 의 가로 패딩(spacing.lg)을
  // 음수 마진으로 상쇄한다(GraduationTracker 가 자체 가로 패딩으로 전체폭 정렬을 전제).
  listFooterSection: {
    marginHorizontal: -spacing.lg,
  },
  notifBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  notifBadgeText: {
    color: palette.white,
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 14,
  },
});
