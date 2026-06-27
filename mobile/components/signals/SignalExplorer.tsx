import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { SignalExploreCard } from '@components/signals/SignalExploreCard';
import { DisclaimerSection } from '@components/common/DisclaimerSection';
import { EmptyState, ApiErrorState } from '@components/common/StateView';
import { emptyStateCopy } from '@components/common/emptyStateCopy';
import { SkeletonList } from '@components/common/SkeletonCard';
import { InfiniteListFooter } from '@components/common/InfiniteListFooter';
import { useExploreSignals } from '@hooks/useSignals';
import { dedupeBy, dedupeByStock } from '@utils/dedupe';
import { verticalHitSlopForHeight } from '@utils/touchTarget';
import {
  GRADE_FILTER_OPTIONS,
  PERSONA_FILTER_OPTIONS,
  EVENT_TYPE_FILTER_OPTIONS,
  SIGNAL_SORT_OPTIONS,
} from '@utils/signalFilters';

import type { TradingSignal, SignalGrade, SignalSort } from '@app-types/signal.types';

// 등급무관 분석 탐색(DAR-46) — 전체 시그널을 등급/페르소나/이벤트유형 필터 + 정렬로 탐색.
// 무한스크롤·pull-refresh는 DAR-45 패턴(useInfiniteQuery + onEndReached + InfiniteListFooter)을 재사용한다.

// 종목 검색(DAR-157): 백엔드 /signals는 키워드 검색 미지원 → 불러온 페이지를 corpName/ticker로
// 클라이언트 필터. 검색 결과가 1페이지를 넘어도 보이도록 검색 중에도 추가 페이지를 로드한다.
//  - 결과가 sparse(화면을 못 채움)하면 onEndReached가 안 뜨므로 자동으로 다음 페이지를 당겨온다.
//  - 무한 로딩 방지: 자동 로딩은 MAX_SEARCH_AUTOLOAD_PAGES까지만(상한 도달 시 범위 한계 안내).
const MAX_SEARCH_AUTOLOAD_PAGES = 15; // ≈300건(20/page)까지만 검색용 자동 로딩
const MIN_SEARCH_RESULTS_TO_FILL = 8; // 이 미만이면 스크롤이 안 생겨 자동 로딩 필요

interface ChipOption<T> {
  value: T;
  label: string;
}

interface FilterChipRowProps<T> {
  label: string;
  options: ChipOption<T>[];
  selected: T;
  onSelect: (value: T) => void;
}

function FilterChipRow<T extends string | undefined>({
  label,
  options,
  selected,
  onSelect,
}: FilterChipRowProps<T>) {
  const { colors, typography: typo } = useTheme();
  return (
    <View style={styles.filterGroup}>
      <Text style={[typo.small, styles.filterLabel, { color: colors.textTertiary }]}>{label}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {options.map((opt) => {
          const isActive = selected === opt.value;
          return (
            <TouchableOpacity
              key={opt.label}
              style={[
                styles.chip,
                isActive
                  ? { backgroundColor: colors.primary }
                  : { backgroundColor: colors.surface, borderColor: colors.borderLight, borderWidth: 1 },
              ]}
              onPress={() => onSelect(opt.value)}
              activeOpacity={0.7}
              // DAR-449(B7): 필터칩 시각 높이 34pt(<44) — 시각 크기 유지하며 유효 터치 영역만 44pt로 보정.
              hitSlop={verticalHitSlopForHeight(34)}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={`${label} ${opt.label}${isActive ? ', 선택됨' : ''}`}
            >
              <Text
                numberOfLines={1}
                maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
                style={[
                  typo.small,
                  {
                    color: isActive ? colors.primaryForeground : colors.text,
                    fontWeight: isActive ? '600' : '400',
                  },
                ]}
              >
                {opt.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

interface SignalExplorerProps {
  /** 종목 검색어(DAR-117) — corpName/ticker 클라이언트 필터. 빈 문자열이면 전체. */
  searchQuery?: string;
  /** 큐레이션 슬롯·검색 입력 등 L1/L2 상단 요소를 리스트 헤더로 주입(단일 스크롤 컨테이너). */
  ListHeaderComponent?: React.ReactElement | null;
  /** DAR-181: 탭 재탭 시 최상단 복귀(useScrollToTop)를 위해 내부 FlatList ref를 부모에 노출. */
  listRef?: React.RefObject<FlatList<TradingSignal> | null>;
}

export function SignalExplorer({ searchQuery = '', ListHeaderComponent, listRef }: SignalExplorerProps) {
  const { colors, typography: typo } = useTheme();
  const [grade, setGrade] = useState<SignalGrade | undefined>(undefined);
  const [persona, setPersona] = useState<string | undefined>(undefined);
  const [eventType, setEventType] = useState<string | undefined>(undefined);
  const [sort, setSort] = useState<SignalSort>('score');
  // DAR-196: 3행 필터칩을 단일 "필터" 토글 뒤로 접어 피드 상단 밀림 해소(기본 접힘·활성 수 배지).
  const [filtersExpanded, setFiltersExpanded] = useState(false);

  const filters = useMemo(
    () => ({ grade, personaType: persona, eventType, sort }),
    [grade, persona, eventType, sort],
  );
  const query = useExploreSignals(filters);

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const isSearching = trimmedQuery.length > 0;
  const isFilterActive =
    grade !== undefined || persona !== undefined || eventType !== undefined || isSearching;
  // 검색은 별도 입력(상단 검색바)이라 "필터" 배지에는 등급·투자성향·이벤트 3개만 집계한다.
  const activeFilterCount =
    (grade !== undefined ? 1 : 0) +
    (persona !== undefined ? 1 : 0) +
    (eventType !== undefined ? 1 : 0);

  const resetFilters = useCallback(() => {
    setGrade(undefined);
    setPersona(undefined);
    setEventType(undefined);
  }, []);

  const toggleFilters = useCallback(() => setFiltersExpanded((v) => !v), []);

  const items = useMemo(() => {
    const all = query.data?.pages.flatMap((page) => page.data) ?? [];
    // 1차: 동일 id 페이지 경계 중복 제거. 2차(DAR-122): 종목당 1카드(데이터 레벨 중복
    // 보조 방어선) — 한 종목의 다수 Persona/공시 신호를 점수순 첫 1건으로 collapse.
    const byId = dedupeBy(all, (item) => item.id);
    const deduped = dedupeByStock(byId, (item) => item.id);
    // 종목 검색(DAR-117): 서버 키워드 검색 미존재 → corpName/ticker 클라이언트 필터.
    if (!trimmedQuery) return deduped;
    return deduped.filter(
      (item) =>
        item.corpName.toLowerCase().includes(trimmedQuery) ||
        (item.ticker?.toLowerCase().includes(trimmedQuery) ?? false),
    );
  }, [query.data, trimmedQuery]);

  // 검색 중에는 서버 total이 아니라 필터된 건수를 노출(정직한 결과 수).
  const totalCount = isSearching ? items.length : query.data?.pages[0]?.meta.total ?? 0;

  // 검색용 자동 로딩 상태 — 불러온 페이지 수가 상한에 닿으면 자동 로딩 중단(범위 한계).
  const loadedPages = query.data?.pages.length ?? 0;
  const searchAutoloadCapped = loadedPages >= MAX_SEARCH_AUTOLOAD_PAGES;
  const canLoadMore = !!query.hasNextPage && !query.isFetchingNextPage;

  // 검색 결과가 sparse하면 스크롤이 안 생겨 onEndReached가 발화하지 않는다.
  // 매칭이 뒤쪽 페이지에 있을 수 있으므로, 결과가 적을 때 상한까지 다음 페이지를 자동 로드.
  useEffect(() => {
    if (!isSearching || !canLoadMore || searchAutoloadCapped) return;
    if (items.length >= MIN_SEARCH_RESULTS_TO_FILL) return;
    query.fetchNextPage();
  }, [isSearching, canLoadMore, searchAutoloadCapped, items.length, query]);

  const handlePress = useCallback((signal: TradingSignal) => {
    router.push(`/signals/${signal.id}`);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: TradingSignal }) => (
      <SignalExploreCard signal={item} onPress={handlePress} />
    ),
    [handlePress],
  );

  // 필터·정렬 영역을 리스트 헤더로 묶어, 주입된 상단 슬롯(L1 큐레이션·검색)과 함께 단일 스크롤.
  const filterHeader = (
    <View>
      {ListHeaderComponent}

      {/* DAR-196: 기본 노출은 정렬행+결과수+"필터" 토글만. 3행 필터칩은 opt-in 시에만 펼쳐진다. */}
      <View style={styles.sortRow}>
        <View style={styles.controlLeft}>
          <TouchableOpacity
            style={[
              styles.filterToggle,
              activeFilterCount > 0
                ? { backgroundColor: colors.primaryLight, borderColor: colors.primary }
                : { backgroundColor: colors.surface, borderColor: colors.borderLight },
            ]}
            onPress={toggleFilters}
            activeOpacity={0.7}
            hitSlop={verticalHitSlopForHeight(32)}
            accessibilityRole="button"
            accessibilityState={{ expanded: filtersExpanded }}
            accessibilityLabel={`필터${activeFilterCount > 0 ? `, ${activeFilterCount}개 적용됨` : ''}, ${filtersExpanded ? '펼침' : '접힘'}`}
          >
            <Feather
              name="sliders"
              size={12}
              color={activeFilterCount > 0 ? colors.primaryDark : colors.textSecondary}
            />
            <Text
              numberOfLines={1}
              maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
              style={[
                typo.small,
                {
                  color: activeFilterCount > 0 ? colors.primaryDark : colors.textSecondary,
                  fontWeight: activeFilterCount > 0 ? '600' : '400',
                },
              ]}
            >
              필터
            </Text>
            {activeFilterCount > 0 ? (
              <View style={[styles.filterBadge, { backgroundColor: colors.primary }]}>
                <Text style={[typo.small, styles.filterBadgeText, { color: colors.primaryForeground }]}>
                  {activeFilterCount}
                </Text>
              </View>
            ) : null}
            <Feather
              name={filtersExpanded ? 'chevron-up' : 'chevron-down'}
              size={14}
              color={activeFilterCount > 0 ? colors.primaryDark : colors.textTertiary}
            />
          </TouchableOpacity>
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            {totalCount > 0 ? `${totalCount.toLocaleString()}건` : ''}
          </Text>
        </View>
        <View style={styles.sortChips}>
          {SIGNAL_SORT_OPTIONS.map((opt) => {
            const isActive = sort === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.sortChip,
                  isActive
                    ? { backgroundColor: colors.primaryLight, borderColor: colors.primary, borderWidth: 1 }
                    : { backgroundColor: colors.surface, borderColor: colors.borderLight, borderWidth: 1 },
                ]}
                onPress={() => setSort(opt.value)}
                activeOpacity={0.7}
                // DAR-449(B7): 정렬칩 시각 높이 30pt(<44) — 시각 크기 유지하며 유효 터치 영역만 44pt로 보정.
                hitSlop={verticalHitSlopForHeight(30)}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                accessibilityLabel={`${opt.label} 정렬${isActive ? ', 선택됨' : ''}`}
              >
                <Feather
                  name={opt.icon}
                  size={12}
                  color={isActive ? colors.primaryDark : colors.textTertiary}
                />
                <Text
                  numberOfLines={1}
                  maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
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
        </View>
      </View>

      {/* opt-in 시에만 공간 차지 — 펼침 상태에서 3행 필터칩 노출(+ 활성 시 초기화). */}
      {filtersExpanded ? (
        <View style={styles.filterPanel}>
          <FilterChipRow label="등급" options={GRADE_FILTER_OPTIONS} selected={grade} onSelect={setGrade} />
          <FilterChipRow
            label="투자성향"
            options={PERSONA_FILTER_OPTIONS}
            selected={persona}
            onSelect={setPersona}
          />
          <FilterChipRow
            label="이벤트"
            options={EVENT_TYPE_FILTER_OPTIONS}
            selected={eventType}
            onSelect={setEventType}
          />
          {activeFilterCount > 0 ? (
            <TouchableOpacity
              style={styles.resetRow}
              onPress={resetFilters}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="필터 초기화"
            >
              <Feather name="rotate-ccw" size={12} color={colors.textSecondary} />
              <Text style={[typo.small, { color: colors.textSecondary }]}>필터 초기화</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {/* 초기 로딩 시 헤더는 유지하고 본문만 스켈레톤(헤더 깜빡임 방지) */}
      {query.isLoading ? <SkeletonList variant="buyScore" /> : null}
    </View>
  );

  return (
    <FlatList
      ref={listRef}
      style={styles.container}
      data={query.isLoading ? [] : items}
      renderItem={renderItem}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={10}
      maxToRenderPerBatch={10}
      windowSize={11}
      removeClippedSubviews
      onEndReached={() => {
        if (!canLoadMore) return;
        // 검색 중에도 다음 페이지를 로드해 클라이언트 필터 대상 데이터셋을 넓힌다.
        // 단, 자동 로딩 상한(MAX_SEARCH_AUTOLOAD_PAGES)에 닿으면 검색 모드에선 중단(범위 한계 안내).
        if (isSearching && searchAutoloadCapped) return;
        query.fetchNextPage();
      }}
      onEndReachedThreshold={0.4}
      refreshing={query.isRefetching && !query.isFetchingNextPage}
      onRefresh={query.refetch}
      ListHeaderComponent={filterHeader}
      ListFooterComponent={
        items.length > 0 && !query.isLoading ? (
          <View>
            <InfiniteListFooter
              isFetchingNextPage={query.isFetchingNextPage}
              hasNextPage={isSearching ? !!query.hasNextPage && !searchAutoloadCapped : !!query.hasNextPage}
              itemCount={items.length}
              endLabel={
                isSearching
                  ? searchAutoloadCapped && query.hasNextPage
                    ? '검색은 불러온 결과 내에서 동작합니다 · 검색어를 좁혀 보세요'
                    : '검색 결과의 끝입니다'
                  : undefined
              }
            />
            <DisclaimerSection style={styles.disclaimer} />
          </View>
        ) : null
      }
      ListEmptyComponent={
        query.isLoading ? null : query.isError ? (
          <ApiErrorState
            error={query.error}
            onRetry={query.refetch}
            title="분석 신호를 불러오지 못했습니다"
            description="잠시 후 다시 시도해 주세요."
          />
        ) : isSearching && query.isFetchingNextPage ? (
          // 검색 매칭이 뒤쪽 페이지에 있을 수 있어 자동 로딩 중 — 빈 상태 깜빡임 방지
          <SkeletonList variant="buyScore" />
        ) : isFilterActive ? (
          <EmptyState {...emptyStateCopy.signalsFilterEmpty} onAction={resetFilters} />
        ) : (
          // 표본/분석 대기 안내(§4) — 과신·단정 없이 빈 상태를 우아하게
          <EmptyState {...emptyStateCopy.signalsExploreEmpty} />
        )
      }
    />
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  filterGroup: {
    marginTop: spacing.sm,
  },
  filterLabel: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.xs,
  },
  chipRow: {
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    flexGrow: 1,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    minHeight: 34,
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  controlLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  filterToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.full,
    borderWidth: 1,
    minHeight: 32,
    gap: spacing.xs,
  },
  filterBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: radius.full,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBadgeText: {
    fontWeight: '700',
    lineHeight: 18,
  },
  filterPanel: {
    marginBottom: spacing.xs,
  },
  resetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
  },
  sortChips: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  sortChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    minHeight: 30,
    gap: spacing.xs,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
    flexGrow: 1,
  },
  disclaimer: {
    marginTop: spacing.lg,
  },
});
