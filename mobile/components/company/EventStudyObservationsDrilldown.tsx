import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { useEventStudyObservations } from '@hooks/useEventStudy';
import { formatReturnPct, returnColor } from '@utils/numberFormat';

import type { EventStudyObservation } from '@app-types/signal.types';

interface Props {
  /** 드릴다운 대상 버킷 식별자 (선택된 EventStudyResult.bucketKey) */
  bucketKey: string;
  /** 버킷 표본 수 (토글 라벨 '표본 N건 보기' 표기용) */
  sampleCount: number;
}

function formatYmd(ymd: string): string {
  if (!ymd || ymd.length !== 8) return ymd || '-';
  return `${ymd.slice(0, 4)}.${ymd.slice(4, 6)}.${ymd.slice(6, 8)}`;
}

/**
 * EventStudy 버킷 관측치 드릴다운 (DAR-166).
 *
 * 통계 카드 하단에서 '표본 N건 보기'로 펼치면, 버킷을 구성한 개별 공시(기업·이벤트일·
 * D+5 누적 초과수익 CAR)를 FlatList 로 노출한다 — '이 통계는 실제로 어떤 공시들로
 * 만들어졌나'를 검증할 수 있게 하여 과신을 방지(과신방지 규약 정합).
 *
 * - 펼침 시에만 조회(enabled=expanded) · 더 보기(useInfiniteQuery fetchNextPage)
 * - CAR 미보유('—')는 가짜 0%로 표기하지 않음 · 빈 버킷·오류 흡수 · 테마 토큰·a11y
 */
export function EventStudyObservationsDrilldown({ bucketKey, sampleCount }: Props) {
  const { colors, typography: typo } = useTheme();
  const [expanded, setExpanded] = useState(false);

  const query = useEventStudyObservations(bucketKey, expanded);

  const items = useMemo<EventStudyObservation[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );
  const total = query.data?.pages[0]?.total ?? sampleCount;

  const carColor = useCallback(
    (v: number | null) => (v === null ? colors.textTertiary : returnColor(v, colors)),
    [colors],
  );

  const renderItem = useCallback(
    ({ item }: { item: EventStudyObservation }) => {
      const title = item.corpName ?? item.corpCode;
      return (
        <View
          style={[styles.obsRow, { borderBottomColor: colors.border }]}
          accessible
          accessibilityLabel={`${title}, 이벤트일 ${formatYmd(item.d0Date)}, D+5 초과수익 ${formatReturnPct(item.carD5)}`}
        >
          <View style={styles.obsMain}>
            <Text style={[typo.bodyMedium, { color: colors.text }]} numberOfLines={1}>
              {title}
            </Text>
            <Text style={[typo.small, { color: colors.textTertiary }]}>{formatYmd(item.d0Date)}</Text>
          </View>
          <View style={styles.obsCar}>
            <Text style={[typo.small, { color: colors.textTertiary }]}>D+5 초과</Text>
            <Text style={[typo.bodyMedium, { color: carColor(item.carD5), fontWeight: '600' }]}>
              {formatReturnPct(item.carD5)}
            </Text>
          </View>
        </View>
      );
    },
    [colors, typo, carColor],
  );

  const keyExtractor = useCallback((item: EventStudyObservation) => item.eventId, []);

  return (
    <View style={styles.container}>
      <TouchableOpacity
        onPress={() => setExpanded((v) => !v)}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={[styles.toggle, { borderColor: colors.border, backgroundColor: colors.surface }]}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={`표본 ${total}건 보기 — 이 통계를 구성한 개별 공시 목록`}
      >
        <Feather name="list" size={16} color={colors.primary} />
        <Text style={[typo.bodyMedium, { color: colors.primary, flex: 1, marginLeft: spacing.sm }]}>
          표본 {total.toLocaleString('ko-KR')}건 보기
        </Text>
        <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textSecondary} />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.panel}>
          {query.isLoading ? (
            <View style={styles.center}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : query.isError ? (
            <TouchableOpacity
              onPress={() => query.refetch()}
              style={styles.center}
              accessibilityRole="button"
              accessibilityLabel="표본을 불러오지 못했습니다. 다시 시도"
            >
              <Text style={[typo.small, { color: colors.error }]}>
                표본을 불러오지 못했습니다. 탭하여 다시 시도하세요.
              </Text>
            </TouchableOpacity>
          ) : items.length === 0 ? (
            <View style={styles.center}>
              <Text style={[typo.small, { color: colors.textTertiary, textAlign: 'center' }]}>
                개별 관측치가 아직 없습니다. 산출이 완료되면 표본이 여기에 표시됩니다.
              </Text>
            </View>
          ) : (
            <>
              <FlatList
                data={items}
                renderItem={renderItem}
                keyExtractor={keyExtractor}
                scrollEnabled={false}
                showsVerticalScrollIndicator={false}
              />
              {query.hasNextPage && (
                <TouchableOpacity
                  onPress={() => query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                  style={styles.more}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="표본 더 보기"
                >
                  {query.isFetchingNextPage ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Text style={[typo.small, { color: colors.primary }]}>더 보기</Text>
                  )}
                </TouchableOpacity>
              )}
            </>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.base,
  },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.base,
    borderWidth: 1,
    borderRadius: radius.md,
  },
  panel: {
    marginTop: spacing.sm,
  },
  obsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  obsMain: {
    flex: 1,
    gap: spacing.xs,
  },
  obsCar: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  center: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  more: {
    paddingVertical: spacing.base,
    alignItems: 'center',
  },
});
