import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { Card } from '@components/common/Card';
import { EmptyState, ApiErrorState } from '@components/common/StateView';
import { emptyStateCopy } from '@components/common/emptyStateCopy';
import { SkeletonList } from '@components/common/SkeletonCard';
import { InfiniteListFooter } from '@components/common/InfiniteListFooter';
import { useDisclosures, useDisclosureSearch } from '@hooks/useDisclosures';
import {
  PERIOD_OPTIONS,
  SORT_OPTIONS,
  periodToFrom,
  type PeriodKey,
  type SortKey,
} from '@utils/searchFilters';
import type { Disclosure } from '@app-types/disclosure.types';
import { useDisclosureTypes } from '@hooks/useDisclosureTypes';
import { useRequireAuth } from '@hooks/useRequireAuth';
import { useAuthStore } from '@stores/authStore';
import { getTypeStyle, getTypeLabel } from '@utils/disclosureType';
import { getHighRiskInfo } from '@utils/disclosureRisk';
import { parse, format } from 'date-fns';

export default function DisclosuresScreen() {
  const { colors, typography: typo, isDark } = useTheme();
  const { isAuthenticated, requireAuth } = useRequireAuth();
  const params = useLocalSearchParams<{ watchlistOnly?: string }>();
  const { data: disclosureTypes = [] } = useDisclosureTypes();
  const filters = useMemo(() => ['전체', ...disclosureTypes.map((t) => t.id)], [disclosureTypes]);
  const [activeFilter, setActiveFilter] = useState<string>('전체');
  const [watchlistOnly, setWatchlistOnly] = useState(params.watchlistOnly === 'true');
  const [period, setPeriod] = useState<PeriodKey>('all');
  const [sort, setSort] = useState<SortKey>('latest');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [timer, setTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [searchFocused, setSearchFocused] = useState(false);

  const disclosureType = activeFilter === '전체' ? undefined : activeFilter;
  const isSearching = debouncedQuery.length > 0;
  const from = useMemo(() => periodToFrom(period), [period]);
  const isFilterActive = activeFilter !== '전체' || watchlistOnly || period !== 'all';

  const resetFilters = useCallback(() => {
    setActiveFilter('전체');
    setWatchlistOnly(false);
    setPeriod('all');
    setSort('latest');
  }, []);

  const listQuery = useDisclosures(disclosureType, watchlistOnly, undefined, from);
  const searchQueryResult = useDisclosureSearch(debouncedQuery, disclosureType, sort, from);

  const activeQuery = isSearching ? searchQueryResult : listQuery;

  const items = useMemo(() => {
    const all = activeQuery.data?.pages.flatMap((page) => page.data) ?? [];
    const seen = new Set<string>();
    return all.filter((item) => {
      if (seen.has(item.rcpNo)) return false;
      seen.add(item.rcpNo);
      return true;
    });
  }, [activeQuery.data]);

  const totalCount = activeQuery.data?.pages[0]?.meta.total ?? 0;

  const handleSearchChange = useCallback(
    (text: string) => {
      setSearchQuery(text);
      if (timer) clearTimeout(timer);
      const newTimer = setTimeout(() => setDebouncedQuery(text.trim()), 300);
      setTimer(newTimer);
    },
    [timer],
  );

  const handleFilterPress = (filter: string) => {
    setActiveFilter(filter);
  };

  const renderItem = ({ item }: { item: Disclosure }) => {
    const typeStyle = getTypeStyle(item.disclosureType, isDark);
    // 고위험 5종(거래정지·상폐위험·감사의견·소송·계약해지)은 보고서명으로 1차 식별해 강조.
    const risk = getHighRiskInfo(item.reportName);
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => router.push(`/disclosure/${item.rcpNo}`)}
        accessibilityRole="button"
        accessibilityLabel={
          risk
            ? `고위험 공시 ${risk.label}. ${item.corpName} ${item.reportName}`
            : `${item.corpName} ${item.reportName}`
        }
      >
        <Card
          style={
            risk
              ? { ...styles.card, borderLeftWidth: 3, borderLeftColor: colors.error }
              : styles.card
          }
          variant="elevated"
        >
          <View style={styles.cardHeader}>
            <View style={styles.badgeRow}>
              <View style={[styles.typeBadge, { backgroundColor: typeStyle.bg }]}>
                <Text style={[typo.small, { color: typeStyle.text, fontWeight: '600' }]}>
                  {getTypeLabel(item.disclosureType)}
                </Text>
              </View>
              {risk && (
                <View style={[styles.riskBadge, { backgroundColor: colors.errorSurface }]}>
                  <Ionicons name="warning" size={11} color={colors.error} />
                  <Text style={[typo.small, { color: colors.error, fontWeight: '700' }]}>
                    {risk.label}
                  </Text>
                </View>
              )}
            </View>
            <Text style={[typo.small, { color: colors.textTertiary }]}>{format(parse(item.rcpDt, 'yyyyMMdd', new Date()), 'yyyy.MM.dd')}</Text>
          </View>
          <Text
            style={[
              typo.bodyMedium,
              { color: risk ? colors.error : colors.text, marginTop: spacing.sm },
            ]}
            numberOfLines={2}
          >
            {item.reportName}
          </Text>
          {/* 기업명 보조 탭 — 종목 허브 1탭 직행. 카드 본 탭(공시 상세)과 분리(DAR-155). */}
          {item.corpCode ? (
            <TouchableOpacity
              style={styles.corpLink}
              onPress={() => router.push(`/company/${item.corpCode}`)}
              activeOpacity={0.6}
              hitSlop={{ top: 8, bottom: 8, left: 4, right: 12 }}
              accessibilityRole="link"
              accessibilityLabel={`${item.corpName} 기업 정보 보기`}
            >
              <Text style={[typo.caption, { color: colors.primary }]} numberOfLines={1}>
                {item.corpName}
              </Text>
              <Ionicons name="chevron-forward" size={13} color={colors.primary} />
            </TouchableOpacity>
          ) : (
            <Text style={[typo.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>
              {item.corpName}
            </Text>
          )}
        </Card>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={8}>
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </TouchableOpacity>
        <Text style={[typo.h3, { color: colors.text, marginLeft: spacing.sm }]}>전체 공시</Text>
        <View style={{ flex: 1 }} />
        <Text style={[typo.caption, { color: colors.textSecondary }]}>
          {totalCount.toLocaleString()}건
        </Text>
      </View>

      {/* Search Bar */}
      <View style={[
        styles.searchBar,
        {
          backgroundColor: colors.inputBackground,
          borderColor: searchFocused ? colors.primary : colors.inputBorder,
        },
      ]}>
        <Ionicons name="search" size={18} color={searchFocused ? colors.primary : colors.textTertiary} />
        <TextInput
          style={[typo.body, styles.searchInput, { color: colors.inputText }]}
          placeholder="기업명, 보고서명 검색"
          placeholderTextColor={colors.inputPlaceholder}
          value={searchQuery}
          onChangeText={handleSearchChange}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          returnKeyType="search"
        />

        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={() => handleSearchChange('')} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
          </TouchableOpacity>
        )}
      </View>

      {/* Filter Chips */}
      <View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
          {isAuthenticated && (
            <TouchableOpacity
              style={[
                styles.filterChip,
                watchlistOnly
                  ? { backgroundColor: colors.primary }
                  : { backgroundColor: colors.surface, borderColor: colors.borderLight, borderWidth: 1 },
              ]}
              onPress={() => setWatchlistOnly(!watchlistOnly)}
              activeOpacity={0.7}
            >
              <Ionicons
                name="star"
                size={12}
                color={watchlistOnly ? '#FFFFFF' : colors.primary}
              />
              <Text
                style={[
                  typo.small,
                  {
                    color: watchlistOnly ? '#FFFFFF' : colors.text,
                    fontWeight: watchlistOnly ? '600' : '400',
                  },
                ]}
              >
                관심목록
              </Text>
            </TouchableOpacity>
          )}
          {filters.map((filter) => {
            const isActive = activeFilter === filter;
            const typeStyle = filter !== '전체' ? getTypeStyle(filter, isDark) : null;
            return (
              <TouchableOpacity
                key={filter}
                style={[
                  styles.filterChip,
                  isActive
                    ? { backgroundColor: colors.primary }
                    : { backgroundColor: colors.surface, borderColor: colors.borderLight, borderWidth: 1 },
                ]}
                onPress={() => handleFilterPress(filter)}
                activeOpacity={0.7}
              >
                {!isActive && typeStyle && (
                  <View style={[styles.chipDot, { backgroundColor: typeStyle.text }]} />
                )}
                <Text
                  style={[
                    typo.small,
                    {
                      color: isActive ? '#FFFFFF' : colors.text,
                      fontWeight: isActive ? '600' : '400',
                    },
                  ]}
                >
                  {filter === '전체' ? '전체' : getTypeLabel(filter)}
                </Text>
              </TouchableOpacity>
            );
          })}
          </ScrollView>
        </View>

      {/* 기간 / 정렬 필터 (DAR-45 §2) */}
      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.subFilterRow}
        >
          {PERIOD_OPTIONS.map((opt) => {
            const isActive = period === opt.key;
            return (
              <TouchableOpacity
                key={opt.key}
                style={[
                  styles.subFilterChip,
                  isActive
                    ? { backgroundColor: colors.primaryLight, borderColor: colors.primary, borderWidth: 1 }
                    : { backgroundColor: colors.surface, borderColor: colors.borderLight, borderWidth: 1 },
                ]}
                onPress={() => setPeriod(opt.key)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={`${opt.label} 기간 필터`}
              >
                <Text
                  style={[
                    typo.small,
                    {
                      color: isActive ? colors.primaryDark : colors.textSecondary,
                      fontWeight: isActive ? '600' : '400',
                    },
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            );
          })}
          {/* 정렬: 검색 중일 때만 의미 있음(관련도순) */}
          {isSearching && (
            <>
              <View style={[styles.subFilterDivider, { backgroundColor: colors.border }]} />
              {SORT_OPTIONS.map((opt) => {
                const isActive = sort === opt.key;
                return (
                  <TouchableOpacity
                    key={opt.key}
                    style={[
                      styles.subFilterChip,
                      isActive
                        ? { backgroundColor: colors.primaryLight, borderColor: colors.primary, borderWidth: 1 }
                        : { backgroundColor: colors.surface, borderColor: colors.borderLight, borderWidth: 1 },
                    ]}
                    onPress={() => setSort(opt.key)}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityState={{ selected: isActive }}
                    accessibilityLabel={`${opt.label} 정렬`}
                  >
                    <Ionicons
                      name={opt.key === 'relevance' ? 'sparkles-outline' : 'time-outline'}
                      size={12}
                      color={isActive ? colors.primaryDark : colors.textTertiary}
                    />
                    <Text
                      style={[
                        typo.small,
                        {
                          color: isActive ? colors.primaryDark : colors.textSecondary,
                          fontWeight: isActive ? '600' : '400',
                        },
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </>
          )}
        </ScrollView>
      </View>

      {/* Login Banner */}
      {!isAuthenticated && (
        <TouchableOpacity
          style={{ paddingHorizontal: spacing.lg, marginTop: spacing.sm }}
          onPress={() => {
            useAuthStore.getState().clearAuth();
            router.push('/auth/sign-in');
          }}
          activeOpacity={0.7}
        >
          <View style={[styles.loginBanner, { borderColor: colors.primary, backgroundColor: colors.primaryLight }]}>
            <View style={[styles.loginIconCircle, { borderColor: colors.primary, backgroundColor: colors.surface }]}>
              <Ionicons name="person-outline" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1, marginLeft: spacing.md }}>
              <Text style={[typo.bodyMedium, { color: colors.primaryDark }]}>
                로그인하고 시작하기
              </Text>
              <Text style={[typo.small, { color: colors.primary, marginTop: 2 }]}>
                관심기업 공시만 모아볼 수 있어요
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textTertiary} />
          </View>
        </TouchableOpacity>
      )}

      {/* List */}
      {activeQuery.isLoading ? (
        <SkeletonList variant="disclosure" />
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.rcpNo}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={11}
          removeClippedSubviews
          onEndReached={() => {
            if (activeQuery.hasNextPage && !activeQuery.isFetchingNextPage) {
              activeQuery.fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.4}
          refreshing={activeQuery.isRefetching && !activeQuery.isFetchingNextPage}
          onRefresh={activeQuery.refetch}
          ListFooterComponent={
            <InfiniteListFooter
              isFetchingNextPage={activeQuery.isFetchingNextPage}
              hasNextPage={!!activeQuery.hasNextPage}
              itemCount={items.length}
            />
          }
          ListEmptyComponent={
            activeQuery.isError ? (
              // 연결 실패 시 빈 화면 대신 사유+재시도(DAR-43 §1).
              <ApiErrorState
                error={activeQuery.error}
                onRetry={activeQuery.refetch}
                title="공시를 불러오지 못했습니다"
              />
            ) : isSearching ? (
              // 공시 검색 빈 결과(§1-2)
              <EmptyState icon="search" title={`'${debouncedQuery}' 검색 결과가 없어요`} />
            ) : isFilterActive ? (
              <EmptyState
                {...emptyStateCopy.disclosureFilterEmpty}
                onAction={resetFilters}
              />
            ) : (
              <EmptyState {...emptyStateCopy.homeDisclosureEmpty} />
            )
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.sm,
  },
  searchInput: {
    flex: 1,
    paddingVertical: spacing.xs,
  },
  filterRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    flexGrow: 1,
    gap: spacing.sm,
  },
  subFilterRow: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
    flexGrow: 1,
    alignItems: 'center',
    gap: spacing.sm,
  },
  subFilterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    height: 30,
    gap: spacing.xs,
  },
  subFilterDivider: {
    width: 1,
    height: 18,
    marginHorizontal: spacing.xs,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    height: 34,
    gap: spacing.xs,
  },
  chipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  listContent: {
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  card: {
    marginBottom: 0,
  },
  corpLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: spacing.xs,
    gap: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 1,
  },
  typeBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  riskBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  loginBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.base,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  loginIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
