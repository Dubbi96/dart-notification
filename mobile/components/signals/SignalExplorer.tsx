import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { SignalExploreCard } from '@components/signals/SignalExploreCard';
import { DisclaimerSection } from '@components/common/DisclaimerSection';
import { EmptyState, ApiErrorState } from '@components/common/StateView';
import { emptyStateCopy } from '@components/common/emptyStateCopy';
import { SkeletonList } from '@components/common/SkeletonCard';
import { InfiniteListFooter } from '@components/common/InfiniteListFooter';
import { useExploreSignals } from '@hooks/useSignals';
import {
  GRADE_FILTER_OPTIONS,
  PERSONA_FILTER_OPTIONS,
  EVENT_TYPE_FILTER_OPTIONS,
  SIGNAL_SORT_OPTIONS,
} from '@utils/signalFilters';

import type { TradingSignal, SignalGrade, SignalSort } from '@app-types/signal.types';

// 등급무관 분석 탐색(DAR-46) — 전체 시그널을 등급/페르소나/이벤트유형 필터 + 정렬로 탐색.
// 무한스크롤·pull-refresh는 DAR-45 패턴(useInfiniteQuery + onEndReached + InfiniteListFooter)을 재사용한다.

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
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              accessibilityLabel={`${label} ${opt.label}${isActive ? ', 선택됨' : ''}`}
            >
              <Text
                style={[
                  typo.small,
                  {
                    color: isActive ? '#FFFFFF' : colors.text,
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
}

export function SignalExplorer({ searchQuery = '', ListHeaderComponent }: SignalExplorerProps) {
  const { colors, typography: typo } = useTheme();
  const [grade, setGrade] = useState<SignalGrade | undefined>(undefined);
  const [persona, setPersona] = useState<string | undefined>(undefined);
  const [eventType, setEventType] = useState<string | undefined>(undefined);
  const [sort, setSort] = useState<SignalSort>('score');

  const filters = useMemo(
    () => ({ grade, personaType: persona, eventType, sort }),
    [grade, persona, eventType, sort],
  );
  const query = useExploreSignals(filters);

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const isSearching = trimmedQuery.length > 0;
  const isFilterActive =
    grade !== undefined || persona !== undefined || eventType !== undefined || isSearching;

  const resetFilters = useCallback(() => {
    setGrade(undefined);
    setPersona(undefined);
    setEventType(undefined);
  }, []);

  const items = useMemo(() => {
    const all = query.data?.pages.flatMap((page) => page.data) ?? [];
    const seen = new Set<string>();
    const deduped = all.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
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

      <View style={styles.sortRow}>
        <Text style={[typo.small, { color: colors.textTertiary }]}>
          {totalCount > 0 ? `${totalCount.toLocaleString()}건` : ''}
        </Text>
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

      {/* 초기 로딩 시 헤더는 유지하고 본문만 스켈레톤(헤더 깜빡임 방지) */}
      {query.isLoading ? <SkeletonList variant="buyScore" /> : null}
    </View>
  );

  return (
    <FlatList
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
        // 검색 중에는 클라이언트 필터 결과라 추가 페이지 fetch를 막는다(정직한 결과 수).
        if (!isSearching && query.hasNextPage && !query.isFetchingNextPage) {
          query.fetchNextPage();
        }
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
              hasNextPage={!isSearching && !!query.hasNextPage}
              itemCount={items.length}
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
    height: 34,
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
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
    height: 30,
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
