import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Surface } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { ApiErrorState } from '@components/common/StateView';
import { SkeletonBar, useSkeletonPulse } from '@components/common/SkeletonCard';
import { useDisclosureReactionStats } from '@hooks/useDisclosures';
import { getEventTypeLabel } from '@utils/disclosureType';
import { formatReturnPct, formatWinRate, returnColor } from '@utils/numberFormat';
import { formatYmdDots } from '@utils/datetime';

import type {
  DisclosureReactionResult,
  ReactionStats,
} from '@app-types/disclosure.types';

// 공시 상세 '과거 유사공시 반응' 표준 섹션 (DAR-512, 정본 Wave A).
//  - useDisclosureReactionStats(GET /disclosures/:rcpNo/event-stats, DAR-511 BE)로 같은 이벤트
//    유형 공시의 D+1/D+5/D+20 실제 주가 반응·승률·표본수(n)를 노출. 점수(권고)가 아닌 과거 사실(통계).
//  - 3상태 정직 분기(수용기준 1): 정상(n≥30) / 표본부족(n<30·stats=null) / API실패(재시도).
//  - n 상시 표기 · n<30이면 '표본이 부족해 통계를 표시하지 않습니다' 정직 카피 ·
//    '과거 통계이며 투자권유가 아닙니다' 면책 고정.
//  - 하드코딩 색 0(테마 토큰만) · SignalDateBadge 등 에디션 산출물과 동일 Surface/토큰 정합 · 읽기 전용.

const DISCLAIMER = '과거 통계이며 투자권유가 아닙니다';

/** 섹션 외곽(Surface + 헤더) — FiledFacts/AI 섹션과 동일 규약(border·radius·아이콘+제목). */
function SectionFrame({ children }: { children: React.ReactNode }) {
  const { colors, typography: typo } = useTheme();
  return (
    <Surface
      elevation={0}
      style={[styles.section, { backgroundColor: colors.surface, borderColor: colors.border }]}
      accessibilityLabel="과거 유사공시 반응 섹션"
    >
      <View style={styles.header}>
        <Feather name="trending-up" size={16} color={colors.primary} />
        <Text
          style={[typo.captionMedium, { color: colors.text, marginLeft: spacing.xs }]}
          accessibilityRole="header"
        >
          과거 유사공시 반응
        </Text>
      </View>
      <Text style={[typo.small, { color: colors.textTertiary, marginBottom: spacing.sm }]}>
        같은 유형의 과거 공시가 발표 후 실제로 어떻게 움직였는지 보여줍니다.
      </Text>
      {children}
    </Surface>
  );
}

/** 면책 고정 — 통계 표시 여부와 무관하게 하단 상시 노출(정직 규약). */
function FixedDisclaimer() {
  const { colors, typography: typo } = useTheme();
  return (
    <View style={styles.disclaimerRow} accessible accessibilityLabel={DISCLAIMER}>
      <Feather name="alert-triangle" size={12} color={colors.textTertiary} />
      <Text style={[typo.small, { color: colors.textTertiary, marginLeft: spacing.xs }]}>
        {DISCLAIMER}
      </Text>
    </View>
  );
}

function LoadingSkeleton() {
  // 공용 펄스 훅·외부 opacity 주입형 SkeletonBar 재사용 — 정본과 모션 일치(DAR-333).
  const opacity = useSkeletonPulse();
  return (
    <View accessibilityRole="progressbar" accessibilityLabel="과거 유사공시 반응 불러오는 중">
      <SkeletonBar width="90%" height={18} opacity={opacity} />
      <SkeletonBar width="100%" height={44} opacity={opacity} style={{ marginTop: spacing.sm }} />
    </View>
  );
}

interface MetricCellProps {
  label: string;
  value: string;
  valueColor: string;
}

/** D+N 단일 지표 셀 — 이벤트 통계 화면(MetricCell)과 동일 한 줄 고정·축소 규약. */
function MetricCell({ label, value, valueColor }: MetricCellProps) {
  const { colors, typography: typo } = useTheme();
  return (
    <View style={styles.metricCell}>
      <Text
        style={[typo.small, { color: colors.textTertiary }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.85}
      >
        {label}
      </Text>
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

/** 표본부족(n<minSampleSize) 또는 이벤트 미추출(result 없음) — n 상시 표기 + 정직 카피. */
function InsufficientSample({
  sampleCount,
  minSampleSize,
}: {
  sampleCount: number;
  minSampleSize: number;
}) {
  const { colors, typography: typo } = useTheme();
  return (
    <View
      accessible
      accessibilityLabel={`표본 ${sampleCount}건. 표본이 부족해 통계를 표시하지 않습니다. ${DISCLAIMER}`}
    >
      <Text style={[typo.captionMedium, { color: colors.text }]}>
        표본이 부족해 통계를 표시하지 않습니다
      </Text>
      {/* n 상시 표기(수용기준) — 표본이 부족한 상태에서도 실제 집계 건수를 정직 노출. */}
      <Text style={[typo.caption, { color: colors.textSecondary, marginTop: spacing.xs }]}>
        표본 {sampleCount.toLocaleString('ko-KR')}건 (최소 {minSampleSize}건 필요)
      </Text>
      <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.xs }]}>
        유사공시가 {minSampleSize}건 이상 쌓이면 평균 반응·승률을 보여드려요. 소표본 통계는 허수라 표시하지 않습니다.
      </Text>
    </View>
  );
}

/** 정상(n≥minSampleSize) — 헤드라인 + D+1/D+5/D+20 실제 주가 반응 + 승률 + 산출기간. */
function ReactionStatsBody({
  result,
  stats,
}: {
  result: DisclosureReactionResult;
  stats: ReactionStats;
}) {
  const { colors, typography: typo } = useTheme();
  const n = result.sampleCount;
  const nText = n.toLocaleString('ko-KR');

  const d5Return = formatReturnPct(stats.d5.avgReturn);
  const d5Color = returnColor(stats.d5.avgReturn, colors);
  const winPct = formatWinRate(stats.d5.winRate);
  // 승률 색: 과반(≥50%) success, 미만 error — 이벤트 통계 화면과 동일 규약.
  const winColor = stats.d5.winRate >= 0.5 ? colors.success : colors.error;

  const d1 = formatReturnPct(stats.d1.avgReturn);
  const d20 = formatReturnPct(stats.d20.avgReturn);

  const summaryLabel =
    `${getEventTypeLabel(result.eventType)} 유형 공시 ${nText}건, ` +
    `공시 후 5일 평균 수익률 ${d5Return}, 승률 ${winPct}. ` +
    `D+1 ${d1}, D+20 ${d20}. ${DISCLAIMER}`;

  return (
    <View accessible accessibilityRole="summary" accessibilityLabel={summaryLabel}>
      {/* 이벤트 유형 라벨 — 어떤 유형의 유사공시 표본인지 명시. */}
      <Text style={[typo.small, { color: colors.textSecondary }]}>
        {getEventTypeLabel(result.eventType)}
      </Text>

      {/* 헤드라인(정본 카피): '이 유형 공시 N건, 공시 후 5일 평균 +X%/승률 Y%'. */}
      <Text style={[typo.bodyMedium, { color: colors.text, marginTop: spacing.xs }]}>
        이 유형 공시 {nText}건 · 공시 후 5일 평균{' '}
        <Text style={{ color: d5Color, fontWeight: '600' }}>{d5Return}</Text>
        {' · 승률 '}
        <Text style={{ color: winColor, fontWeight: '600' }}>{winPct}</Text>
      </Text>

      {/* D+1/D+5/D+20 실제 주가 반응(종목 단순수익률 누적 평균) — 이벤트 통계 화면과 동일 셀 규약. */}
      <View style={styles.metricsRow}>
        <MetricCell label="D+1 평균" value={d1} valueColor={returnColor(stats.d1.avgReturn, colors)} />
        <MetricCell label="D+5 평균" value={d5Return} valueColor={d5Color} />
        <MetricCell label="D+20 평균" value={d20} valueColor={returnColor(stats.d20.avgReturn, colors)} />
      </View>

      {/* 시장 대비 초과수익(AR) — 결측 아닐 때만. 시장 등락과 분리한 정직 지표. */}
      {stats.d5.avgAbnormalReturn !== null ? (
        <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.sm }]}>
          시장 대비(초과수익) D+5 {formatReturnPct(stats.d5.avgAbnormalReturn)}
        </Text>
      ) : null}

      {/* 산출기간(표본 D0 경계) — 통계 근거 투명화. */}
      {result.period ? (
        <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.xs }]}>
          표본기간 {formatYmdDots(result.period.fromDate)} ~ {formatYmdDots(result.period.toDate)}
        </Text>
      ) : null}
    </View>
  );
}

export function DisclosureReactionSection({ rcpNo }: { rcpNo: string }) {
  const { data, isLoading, isError, error, refetch } = useDisclosureReactionStats(rcpNo);

  if (isLoading) {
    return (
      <SectionFrame>
        <LoadingSkeleton />
      </SectionFrame>
    );
  }

  // API실패(수용기준 1) — 네트워크/서버 오류는 재시도 동선과 함께 정직 분기.
  if (isError) {
    return (
      <SectionFrame>
        <View style={styles.stateBox}>
          <ApiErrorState
            error={error}
            title="반응 통계를 불러오지 못했습니다"
            description="잠시 후 다시 시도해 주세요."
            onRetry={refetch}
          />
        </View>
      </SectionFrame>
    );
  }

  const result = data?.results?.[0] ?? null;
  const minSampleSize = data?.minSampleSize ?? 30;

  // 표본부족(수용기준 1) — result 없음(이벤트 미추출) 또는 stats=null(n<minSampleSize).
  if (!result || result.stats === null) {
    return (
      <SectionFrame>
        <InsufficientSample sampleCount={result?.sampleCount ?? 0} minSampleSize={minSampleSize} />
        <FixedDisclaimer />
      </SectionFrame>
    );
  }

  // 정상(수용기준 1) — n≥minSampleSize.
  return (
    <SectionFrame>
      <ReactionStatsBody result={result} stats={result.stats} />
      <FixedDisclaimer />
    </SectionFrame>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  stateBox: {
    minHeight: 200,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  metricCell: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    gap: spacing.xs,
  },
  disclaimerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.md,
  },
});
