import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Surface } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme, MAX_CHIP_FONT_SCALE } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { InlineDisclosure } from '@components/common/InlineDisclosure';
import { PriceChangeChip } from '@components/common/PriceChangeChip';
import { DataLimitBadge } from '@components/common/DataLimitBadge';
import { EquityCurveChart } from '@components/portfolio/EquityCurveChart';
import { SkeletonCard } from '@components/common/SkeletonCard';
import { useCoreTrackScorecard } from '@hooks/useCoreTrackScorecard';
import { formatReturnPct, formatWinRate } from '@utils/numberFormat';
import { formatYmdDots } from '@utils/datetime';

import type { CoreTrackScorecard, CoreRebalanceRow } from '@app-types/core-track.types';

// 듀얼모멘텀 코어 트랙(자산배분·월단위) 표면화 — DAR-495 [견고화 W1·P17] (BE: DAR-494/495).
// '전략' 탭의 일봉 4종 백테스트·단타(분봉 forward)와 ★유형이 다른(자산배분·월 1회 리밸런싱)
// 트랙이라, 같은 랭킹에 섞지 않고 별도 섹션 카드로 노출한다(감사 C2 — 사용자 표면의 유형 구분).
// 시각 구분: '자산배분(월단위)' 유형 라벨 + layers 아이콘 + 좌측 액센트 보더 + 다음 판정일 표기.
// 월말 1회 리밸런싱이라 표본 축적이 느려 LOW_SAMPLE 배지로 과신 방지(정직 표기). 테마 토큰만·a11y.

/** ★유형 라벨 배지 — 기존 트랙과 유형이 다름을 형태(layers)+평문으로 고지(감사 C2). */
function TrackTypeBadge({ label }: { label: string }) {
  const { colors, typography: typo } = useTheme();
  return (
    <View
      style={[styles.typeBadge, { backgroundColor: colors.surfaceSecondary }]}
      accessibilityRole="text"
      accessibilityLabel={`트랙 유형: ${label}`}
    >
      <Feather name="layers" size={12} color={colors.primary} />
      <Text
        numberOfLines={1}
        maxFontSizeMultiplier={MAX_CHIP_FONT_SCALE}
        style={[typo.small, { color: colors.primary, flexShrink: 1, minWidth: 0 }]}
        ellipsizeMode="tail"
      >
        {label}
      </Text>
    </View>
  );
}

/** 1차 핵심 지표 — 값을 라벨보다 키운 위계(StrategyCard/ScalpCard 패턴 정합). */
function PrimaryStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  const { colors, typography: typo } = useTheme();
  return (
    <View
      style={styles.primaryStat}
      accessibilityRole="text"
      accessibilityLabel={`${label} ${value}${sub ? ` ${sub}` : ''}`}
    >
      <Text
        style={[typo.small, { color: colors.textSecondary, minWidth: 0 }]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {label}
      </Text>
      {/* R-4: 누적수익 등 숫자값은 말줄임 대신 배율 축소로 온전히 표시(DAR-451 헤드라인 패턴). */}
      <Text
        style={[typo.body, styles.primaryValue, { color: colors.text, minWidth: 0 }]}
        numberOfLines={1}
        ellipsizeMode="tail"
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {value}
      </Text>
      {sub ? (
        <Text
          style={[typo.small, { color: colors.textTertiary, minWidth: 0 }]}
          numberOfLines={1}
          ellipsizeMode="tail"
        >
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

/** 리밸런싱 이력 1행 — ETF 이름·상태·수익률·판정일. */
function RebalanceRow({ row }: { row: CoreRebalanceRow }) {
  const { colors, typography: typo } = useTheme();
  const name = row.etfName ?? row.etfCode;
  const isClosed = row.status === 'CLOSED';
  const statusLabel = isClosed ? '청산' : '보유';
  return (
    <View
      style={[styles.historyRow, { borderTopColor: colors.borderLight }]}
      accessibilityRole="text"
      accessibilityLabel={`${formatYmdDots(row.decisionDate)} ${name} ${statusLabel}${
        isClosed && row.returnPct !== null ? ` 수익률 ${formatReturnPct(row.returnPct)}` : ''
      }`}
    >
      <Text
        style={[typo.small, { color: colors.textTertiary, width: 84, flexShrink: 1, minWidth: 0 }]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {formatYmdDots(row.decisionDate)}
      </Text>
      <Text
        style={[typo.small, { color: colors.text, flex: 1, minWidth: 0 }]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {name}
      </Text>
      {/* R-4: 수익률 숫자는 말줄임 금지 — flexShrink:0으로 보호(name 컬럼이 대신 양보). */}
      <Text style={[typo.small, { color: colors.textSecondary, flexShrink: 0 }]}>
        {isClosed && row.returnPct !== null ? formatReturnPct(row.returnPct) : statusLabel}
      </Text>
    </View>
  );
}

function CoreTrackCard({ data }: { data: CoreTrackScorecard }) {
  const { colors, typography: typo } = useTheme();
  const holdingLabel = data.holding
    ? (data.holdingName ?? data.holding)
    : data.pendingTarget
      ? `${data.pendingTargetName ?? data.pendingTarget} 예약`
      : '현금';

  return (
    <Surface
      elevation={1}
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          borderLeftColor: colors.primary,
        },
      ]}
    >
      <View style={styles.cardHead}>
        <View style={styles.cardTitleRow}>
          <Text style={[typo.bodyMedium, { color: colors.text }]}>자산배분 (듀얼모멘텀 코어)</Text>
          <TrackTypeBadge label={data.trackTypeLabel} />
          {data.lowSample ? <DataLimitBadge sampleCount={data.scorecard.sampleSize} /> : null}
        </View>
        <PriceChangeChip value={data.cumulativeReturnPct} context="pnl" />
      </View>

      {/* 유형 고지 — 일봉 4종·단타와 성격이 다름(월 1회 리밸런싱·모멘텀 배분). */}
      <Text style={[typo.small, { color: colors.textTertiary }]} numberOfLines={2}>
        {data.tagline}
      </Text>

      {/* 1차 핵심 3수치 — 누적수익·승률·현재 보유. */}
      <View style={styles.primaryRow}>
        <PrimaryStat label="누적수익" value={formatReturnPct(data.cumulativeReturnPct)} />
        <PrimaryStat
          label="승률"
          value={formatWinRate(data.scorecard.winRate, { fallback: '표본 부족' })}
          sub={`n=${data.scorecard.sampleSize}`}
        />
        <PrimaryStat label="현재 보유" value={holdingLabel} />
      </View>

      {/* ★월 1회 리밸런싱 특성 — 다음 판정 예정일 표기. */}
      <View style={[styles.rebalanceNote, { backgroundColor: colors.surfaceSecondary }]}>
        <Feather name="calendar" size={12} color={colors.textSecondary} />
        <Text
          style={[typo.small, styles.rebalanceNoteText, { color: colors.textSecondary }]}
          numberOfLines={2}
        >
          월 1회 리밸런싱 · 다음 판정 예정 {formatYmdDots(data.nextDecisionDate)}
        </Text>
      </View>

      {/* 미니 자산곡선 옵션화 — '한 탭 뒤'로 접어 카드 기본 높이를 압축(점 0·1개도 정직 표기). */}
      <InlineDisclosure label="미니 자산곡선" icon="trending-up">
        {data.equityCurve.length > 0 ? (
          <EquityCurveChart points={data.equityCurve} initialCapital={data.initialCapital} />
        ) : (
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            월말 리밸런싱이 누적되면 forward 자산곡선이 표시됩니다.
          </Text>
        )}
      </InlineDisclosure>

      {/* 리밸런싱(회전) 이력 — 판정일·ETF·수익률. */}
      <InlineDisclosure label="리밸런싱 이력" icon="repeat">
        {data.rebalanceHistory.length > 0 ? (
          <View>
            {data.rebalanceHistory
              .slice()
              .reverse()
              .map((row) => (
                <RebalanceRow key={`${row.decisionDate}-${row.etfCode}-${row.status}`} row={row} />
              ))}
          </View>
        ) : (
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            아직 리밸런싱 회전이 없습니다 — 첫 월말 판정 이후 표시됩니다.
          </Text>
        )}
      </InlineDisclosure>
    </Surface>
  );
}

/**
 * 듀얼모멘텀 코어 트랙 섹션 — '전략' 탭 상단 별도 섹션(백테스트 4종·단타와 유형 분리).
 * StrategyComparisonSection 의 ListHeaderComponent 로 렌더되어 같은 스크롤에 포함된다.
 * 로딩/에러는 카드 자리에서 graceful(전체 탭을 막지 않음).
 */
export function CoreTrackSection() {
  const { colors, typography: typo } = useTheme();
  const query = useCoreTrackScorecard();

  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Feather name="layers" size={14} color={colors.primary} />
        <Text style={[typo.captionMedium, { color: colors.text }]}>
          자산배분 트랙 (코어·월단위)
        </Text>
      </View>
      <Text style={[typo.small, { color: colors.textTertiary, marginBottom: spacing.sm }]}>
        월말 모멘텀 판정으로 ETF·채권을 배분하는 자산배분 트랙 — 아래 백테스트·단타와 유형이
        다릅니다.
      </Text>

      {query.isLoading ? (
        <SkeletonCard variant="buyScore" />
      ) : query.isError || !query.data ? (
        <Surface
          elevation={1}
          style={[
            styles.card,
            {
              backgroundColor: colors.surface,
              borderColor: colors.border,
              borderLeftColor: colors.primary,
            },
          ]}
        >
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            자산배분 트랙을 불러오지 못했습니다.
          </Text>
          <TouchableOpacity
            onPress={() => query.refetch()}
            style={styles.retryRow}
            accessibilityRole="button"
            accessibilityLabel="자산배분 트랙 다시 시도"
          >
            <Feather name="refresh-cw" size={14} color={colors.primary} />
            <Text style={[typo.small, { color: colors.primary }]}>다시 시도</Text>
          </TouchableOpacity>
        </Surface>
      ) : (
        <CoreTrackCard data={query.data} />
      )}

      <View style={[styles.divider, { borderTopColor: colors.border }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  divider: {
    borderTopWidth: 1,
    marginTop: spacing.sm,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderLeftWidth: 3,
    padding: spacing.base,
    gap: spacing.sm,
  },
  cardHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    flexShrink: 1,
    flexWrap: 'wrap',
  },
  typeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  primaryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  primaryStat: {
    flex: 1,
    gap: 2,
  },
  primaryValue: {
    fontWeight: '700',
  },
  rebalanceNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  rebalanceNoteText: {
    flex: 1,
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderTopWidth: 1,
    paddingVertical: spacing.xs,
  },
  retryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 44,
  },
});
