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

export function SignalExplorer() {
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

  const isFilterActive = grade !== undefined || persona !== undefined || eventType !== undefined;

  const resetFilters = useCallback(() => {
    setGrade(undefined);
    setPersona(undefined);
    setEventType(undefined);
  }, []);

  const items = useMemo(() => {
    const all = query.data?.pages.flatMap((page) => page.data) ?? [];
    const seen = new Set<string>();
    return all.filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [query.data]);

  const totalCount = query.data?.pages[0]?.meta.total ?? 0;

  const handlePress = useCallback((signal: TradingSignal) => {
    router.push(`/signals/${signal.id}`);
  }, []);

  const renderItem = useCallback(
    ({ item }: { item: TradingSignal }) => (
      <SignalExploreCard signal={item} onPress={handlePress} />
    ),
    [handlePress],
  );

  return (
    <View style={styles.container}>
      {/* 필터 영역(칩) — 등급/페르소나/이벤트유형 + 정렬 */}
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

      {/* 정렬 + 결과 수 */}
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

      {/* 리스트 */}
      {query.isLoading ? (
        <SkeletonList variant="buyScore" />
      ) : (
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={11}
          removeClippedSubviews
          onEndReached={() => {
            if (query.hasNextPage && !query.isFetchingNextPage) {
              query.fetchNextPage();
            }
          }}
          onEndReachedThreshold={0.4}
          refreshing={query.isRefetching && !query.isFetchingNextPage}
          onRefresh={query.refetch}
          ListFooterComponent={
            items.length > 0 ? (
              <View>
                <InfiniteListFooter
                  isFetchingNextPage={query.isFetchingNextPage}
                  hasNextPage={!!query.hasNextPage}
                  itemCount={items.length}
                />
                <DisclaimerSection style={styles.disclaimer} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            query.isError ? (
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
      )}
    </View>
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
