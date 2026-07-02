import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SegmentedButtons } from 'react-native-paper';
import { router } from 'expo-router';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import { Card } from '@components/common/Card';
import { ScreenHeader } from '@components/common/ScreenHeader';
import { EmptyState, ApiErrorState } from '@components/common/StateView';
import { DetailSkeleton } from '@components/common/DetailSkeleton';
import { DisclaimerSection } from '@components/common/DisclaimerSection';
import { DataLimitBadge } from '@components/common/DataLimitBadge';
import { useEventStudyResults } from '@hooks/useEventStudy';
import { getEventTypeLabel } from '@utils/disclosureType';
import { isDataLimited, DATA_LIMIT_SAMPLE_THRESHOLD } from '@utils/dataLimit';
import { formatReturnPct, formatWinRate, returnColor } from '@utils/numberFormat';

import type { EventStudyResult } from '@app-types/signal.types';

// DAR-81: 이벤트 유형별 시장 통계 화면.
// 기구현 useEventStudyResults(GET /event-study) 연결 — 백엔드 집계는 (eventType, bucketKey)
// 단위 행으로 내려오므로, 화면에서 eventType 단위로 표본수 가중 평균하여
// '시장 전체 평균 D+N 초과수익(AR)·표본수·승률'을 유형별 1행으로 렌더한다. read-only.
// 표본 부족·통계 미유의 시 공용 DataLimitBadge('데이터 한계')로 과신 방지(DAR-121 §6 통일).
// 테마토큰만·FlatList·접근성·면책.

type MarketType = 'ALL' | 'KOSPI' | 'KOSDAQ';

/** 이벤트 유형별 시장 전체 집계 1행. (eventType, bucketKey) 단위 행들을 유형 단위로 합산. */
export interface EventTypeAggregate {
  eventType: string;
  totalSample: number;
  /** 표본 가중 평균 D+1 시장초과수익(AR, %) */
  avgArD1: number;
  /** 표본 가중 평균 D+5 시장초과수익(AR, %) */
  avgArD5: number;
  /** 표본 가중 평균 D+20 시장초과수익(AR, %) */
  avgArD20: number;
  /** 표본 가중 평균 D+5 상승확률(승률, 0~1) */
  winRateD5: number;
  /** 유의성: 버킷 중 하나 이상이 통계적으로 유의(p<0.05) */
  isSignificant: boolean;
  /** 과신 방지: 표본 부족 또는 통계 미유의 */
  lowSample: boolean;
}

/**
 * (eventType, bucketKey) 단위 EventStudyResult[] → 이벤트 유형 단위 시장 전체 집계.
 * 순수함수: 표본수 가중 평균으로 AR·승률을 합산하고 초과수익(D+5) 내림차순 정렬한다.
 */
export function aggregateByEventType(rows: EventStudyResult[]): EventTypeAggregate[] {
  const byType = new Map<string, EventStudyResult[]>();
  for (const r of rows) {
    const list = byType.get(r.eventType);
    if (list) list.push(r);
    else byType.set(r.eventType, [r]);
  }

  const aggregates: EventTypeAggregate[] = [];
  byType.forEach((list, eventType) => {
    const totalSample = list.reduce((sum, r) => sum + (r.sampleCount ?? 0), 0);
    const weighted = (pick: (r: EventStudyResult) => number): number => {
      if (totalSample <= 0) return 0;
      const acc = list.reduce((sum, r) => sum + pick(r) * (r.sampleCount ?? 0), 0);
      return acc / totalSample;
    };
    const isSignificant = list.some((r) => r.isSignificant);
    aggregates.push({
      eventType,
      totalSample,
      avgArD1: weighted((r) => r.avgArD1 ?? 0),
      avgArD5: weighted((r) => r.avgArD5 ?? 0),
      avgArD20: weighted((r) => r.avgArD20 ?? 0),
      winRateD5: weighted((r) => r.upProbD5 ?? 0),
      isSignificant,
      lowSample: isDataLimited({ sampleCount: totalSample, isSignificant }),
    });
  });

  // 초과수익(D+5) 내림차순 — '실제 초과수익을 내는' 유형이 위로(기획: 초과수익순).
  return aggregates.sort((a, b) => b.avgArD5 - a.avgArD5);
}

interface MetricCellProps {
  label: string;
  value: string;
  valueColor: string;
}

function MetricCell({ label, value, valueColor }: MetricCellProps) {
  const { colors, typography: typo } = useTheme();
  return (
    <View style={styles.metricCell}>
      {/* DAR-472(DAR-466 후속): 라벨도 값과 동일하게 한 줄 고정 + 폭 초과 시 축소 —
          좁은 기기에서 '승률(D+5)'·'D+20 초과' 라벨이 말줄임되지 않고 또렷이 유지된다. */}
      <Text
        style={[typo.small, { color: colors.textTertiary }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
        {label}
      </Text>
      {/* DAR-466: 좁은 기기에서 '-100.0%' 등 절단 방지 — 한 줄 고정 + 폭 초과 시 축소(adjustsFontSizeToFit). */}
      <Text
        style={[typo.bodyMedium, { color: valueColor, fontWeight: '600' }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
        {value}
      </Text>
    </View>
  );
}

interface EventRowProps {
  item: EventTypeAggregate;
}

function EventRow({ item }: EventRowProps) {
  const { colors, typography: typo } = useTheme();
  const arColor = (v: number) => returnColor(v, colors);
  const winColor = item.winRateD5 >= 0.5 ? colors.success : colors.error;
  const winPct = formatWinRate(item.winRateD5);

  return (
    <Card variant="elevated" style={styles.row}>
      <View
        accessible
        accessibilityRole="summary"
        accessibilityLabel={
          `${getEventTypeLabel(item.eventType)} — D+5 시장초과수익 ${formatReturnPct(item.avgArD5)}, ` +
          `D+20 ${formatReturnPct(item.avgArD20)}, 승률 ${winPct}, 표본 ${item.totalSample}건` +
          (item.lowSample ? ', 표본 부족 또는 통계 미유의로 신뢰도 제한' : '')
        }
        style={styles.rowInner}
      >
        <View style={styles.rowHeader}>
          <Text style={[typo.bodyMedium, { color: colors.text, flex: 1 }]} numberOfLines={1}>
            {getEventTypeLabel(item.eventType)}
          </Text>
          {item.lowSample ? <DataLimitBadge /> : null}
        </View>

        {/* DAR-466(E16): 5컬럼 1행 과밀/절단 해소 — 초과수익 3종(1행) + 승률·표본(2행)으로 분리. */}
        <View style={styles.metrics}>
          <View style={styles.metricsRow}>
            <MetricCell label="D+1 초과" value={formatReturnPct(item.avgArD1)} valueColor={arColor(item.avgArD1)} />
            <MetricCell label="D+5 초과" value={formatReturnPct(item.avgArD5)} valueColor={arColor(item.avgArD5)} />
            <MetricCell label="D+20 초과" value={formatReturnPct(item.avgArD20)} valueColor={arColor(item.avgArD20)} />
          </View>
          <View style={styles.metricsRow}>
            <MetricCell label="승률(D+5)" value={winPct} valueColor={winColor} />
            <MetricCell label="표본" value={`${item.totalSample.toLocaleString('ko-KR')}건`} valueColor={colors.text} />
          </View>
        </View>
      </View>
    </Card>
  );
}

export default function EventStatsScreen() {
  const { colors, typography: typo } = useTheme();
  const [marketType, setMarketType] = useState<MarketType>('ALL');

  const query = useEventStudyResults(undefined, marketType);

  const aggregates = useMemo(() => aggregateByEventType(query.data ?? []), [query.data]);
  const hasData = aggregates.length > 0;

  const renderItem = useCallback(
    ({ item }: { item: EventTypeAggregate }) => <EventRow item={item} />,
    [],
  );

  const keyExtractor = useCallback((item: EventTypeAggregate) => item.eventType, []);

  const renderBody = () => {
    if (query.isLoading) {
      // 헤더·시장 탭은 유지되고 본문만 이벤트 행 골격 스켈레톤으로 채워 점프 제거(DAR-147).
      return (
        <DetailSkeleton
          cards={[{ lines: 2 }, { lines: 2 }, { lines: 2 }, { lines: 2 }, { lines: 2 }]}
        />
      );
    }
    if (query.isError) {
      return (
        <ApiErrorState
          error={query.error}
          title="이벤트 통계를 불러오지 못했습니다"
          description="잠시 후 다시 시도해 주세요."
          onRetry={query.refetch}
        />
      );
    }
    return (
      <FlatList
        data={aggregates}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        refreshing={query.isRefetching}
          onRefresh={query.refetch}
        ListHeaderComponent={
          hasData ? (
            <Text style={[typo.small, { color: colors.textSecondary, marginBottom: spacing.md }]}>
              공시 유형별 시장 전체 평균 초과수익(시장 대비)·승률·표본입니다. 초과수익(D+5) 높은 순.
              표본 {DATA_LIMIT_SAMPLE_THRESHOLD}건 미만이거나 통계적으로 유의하지 않으면 데이터 한계로 표시되며 참고용입니다.
            </Text>
          ) : null
        }
        ListEmptyComponent={
          <EmptyState
            icon="bar-chart-2"
            title="아직 집계된 이벤트 통계가 없습니다"
            description={
              marketType === 'ALL'
                ? '이벤트 스터디 데이터가 쌓이면 유형별 초과수익이 여기에 표시됩니다.'
                : '선택한 시장의 집계 데이터가 아직 없습니다. 다른 시장을 확인해 보세요.'
            }
          />
        }
        ListFooterComponent={hasData ? <DisclaimerSection style={styles.disclaimer} /> : null}
      />
    );
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]} edges={['top']}>
      <ScreenHeader
        title="이벤트 통계"
        subtitle="어떤 공시 유형이 실제 초과수익을 냈는가"
        onBack={() => router.back()}
      />

      <View style={styles.tabs}>
        {/* DAR-308: SegmentedButtons 라벨은 전역 allowFontScaling=false(DAR-304) 정책으로 비율 보존 — per-Text 캡 미적용. */}
        <SegmentedButtons
          value={marketType}
          onValueChange={(v) => setMarketType(v as MarketType)}
          buttons={[
            { value: 'ALL', label: '전체' },
            { value: 'KOSPI', label: '코스피' },
            { value: 'KOSDAQ', label: '코스닥' },
          ]}
        />
      </View>

      <View style={styles.body}>{renderBody()}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tabs: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  body: {
    flex: 1,
  },
  listContent: {
    padding: spacing.lg,
    gap: spacing.md,
    flexGrow: 1,
  },
  row: {
    padding: spacing.base,
  },
  rowInner: {
    gap: spacing.md,
  },
  rowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  metrics: {
    gap: spacing.md,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  metricCell: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: spacing.xs,
  },
  disclaimer: {
    marginTop: spacing.lg,
  },
});
