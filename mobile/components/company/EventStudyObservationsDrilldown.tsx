import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { SkeletonBar, useSkeletonPulse } from '@components/common/SkeletonCard';
import { useEventStudyObservations } from '@hooks/useEventStudy';
import { formatReturnPct, returnColor } from '@utils/numberFormat';
import { formatYmdDots } from '@utils/datetime';

import type { EventStudyObservation } from '@app-types/signal.types';

/**
 * 관측치 로딩 스켈레톤(E17·DAR-467) — 펼침 직후 중앙 ActivityIndicator → 콘텐츠와 동일한
 * obsRow 골격의 펄스 스켈레톤으로 통일해 로딩→목록 레이아웃 점프를 제거한다.
 * 단일 펄스(useSkeletonPulse)·SkeletonBar·동일 행 스타일을 재사용해 일관성을 유지한다.
 * (페이지네이션 '더 보기' 푸터의 인라인 스피너는 적합 패턴이라 보존.)
 */
const OBSERVATION_SKELETON_ROWS = 4;

function ObservationsSkeleton() {
  const { colors } = useTheme();
  const opacity = useSkeletonPulse();
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="표본 불러오는 중">
      {Array.from({ length: OBSERVATION_SKELETON_ROWS }).map((_, i) => (
        <View key={i} style={[styles.obsRow, { borderBottomColor: colors.border }]}>
          <View style={styles.obsMain}>
            <SkeletonBar width="55%" height={16} opacity={opacity} />
            <SkeletonBar width="32%" height={12} opacity={opacity} />
          </View>
          <View style={styles.obsCar}>
            <SkeletonBar width={44} height={12} opacity={opacity} />
            <SkeletonBar width={56} height={16} opacity={opacity} />
          </View>
        </View>
      ))}
    </View>
  );
}

interface Props {
  /** 드릴다운 대상 버킷 식별자 (선택된 EventStudyResult.bucketKey) */
  bucketKey: string;
  /** 버킷 표본 수 (토글 라벨 '표본 N건 보기' 표기용) */
  sampleCount: number;
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
          accessibilityLabel={`${title}, 이벤트일 ${formatYmdDots(item.d0Date)}, D+5 초과수익 ${formatReturnPct(item.carD5)}`}
        >
          <View style={styles.obsMain}>
            <Text
              style={[typo.bodyMedium, { color: colors.text, minWidth: 0 }]}
              numberOfLines={1}
              ellipsizeMode="tail"
            >
              {title}
            </Text>
            <Text style={[typo.small, { color: colors.textTertiary }]}>
              {formatYmdDots(item.d0Date)}
            </Text>
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
        <Text
          style={[
            typo.bodyMedium,
            { color: colors.primary, flex: 1, marginLeft: spacing.sm, minWidth: 0 },
          ]}
          numberOfLines={1}
          maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
          ellipsizeMode="tail"
        >
          표본 {total.toLocaleString('ko-KR')}건 보기
        </Text>
        <Feather
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.textSecondary}
        />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.panel}>
          {query.isLoading ? (
            <ObservationsSkeleton />
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
