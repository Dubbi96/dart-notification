import React, { useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Surface } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { ApiErrorState } from '@components/common/StateView';
import { SkeletonCard } from '@components/common/SkeletonCard';
import { DataLimitBadge } from '@components/common/DataLimitBadge';
import { isDataLimited } from '@utils/dataLimit';
import { useGraduationFunnel } from '@hooks/useGraduationFunnel';

import type { FunnelReport, FunnelTotals } from '@app-types/graduation.types';

// 홈 '신호에서 체결까지' 카드(DAR-162, 편의성·시인성 v6).
// DAR-446(A-HOME-1): UI 문구에서 전문용어 '퍼널' 제거 → '신호에서 체결까지' 평이어로 치환.
// 백엔드 GET /graduation/funnel(DAR-109)을 소비해 '생성 신호 N → 진입 후보 M → 체결 K'의
// 누적 단계별 수치·전환율 바를 노출한다. 신호가 실제 진입으로 얼마나 이어지는지 한눈에.
// 표본 부족(생성 신호<30)은 DataLimitBadge 로 정직 표기(과신 방지·LOW_SAMPLE 흡수).
// 테마 토큰만 사용·하드코딩 색상 0·접근성 라벨. 측정값은 참고용(면책 유지).

/** 누적 표본의 데이터 한계 판정 기준(생성 신호 수). */
function funnelLowSample(totals: FunnelTotals): boolean {
  return isDataLimited({ sampleCount: totals.signalsGenerated });
}

/** 전환율 표기 — 0~1 → '60%'. null(분모 0, 측정 불가)이면 '—'. */
function formatRate(rate: number | null): string {
  if (rate === null) return '—';
  return `${Math.round(rate * 100)}%`;
}

/** 바 너비 비율(0~100). 분모(최대 신호 수) 0이면 0. */
function barWidthPercent(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((value / max) * 100)));
}

interface StageProps {
  label: string;
  count: number;
  /** 바 채움 너비(0~100%) */
  widthPercent: number;
  /** 바 채움 색(테마 토큰) */
  fillColor: string;
  /** 직전 단계 대비 전환율 캡션(없으면 미표기 = 최상단 신호 단계) */
  rateCaption?: string;
}

function FunnelStage({ label, count, widthPercent, fillColor, rateCaption }: StageProps) {
  const { colors, typography: typo } = useTheme();
  return (
    <View
      style={styles.stage}
      accessibilityRole="text"
      accessibilityLabel={`${label} ${count}건${rateCaption ? `, ${rateCaption}` : ''}`}
    >
      <View style={styles.stageHeader}>
        <Text style={[typo.small, { color: colors.textSecondary }]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[typo.captionMedium, { color: colors.text }]}>
          {count.toLocaleString()}
          <Text style={[typo.small, { color: colors.textTertiary }]}>{' 건'}</Text>
        </Text>
      </View>
      <View
        style={[styles.barTrack, { backgroundColor: colors.surfaceSecondary }]}
        importantForAccessibility="no-hide-descendants"
      >
        <View style={[styles.barFill, { backgroundColor: fillColor, width: `${widthPercent}%` }]} />
      </View>
      {rateCaption ? (
        <Text style={[typo.small, { color: colors.textTertiary }]} importantForAccessibility="no-hide-descendants">
          {rateCaption}
        </Text>
      ) : null}
    </View>
  );
}

function FunnelBody({ report }: { report: FunnelReport }) {
  const { colors, typography: typo } = useTheme();
  const { totals } = report;
  const lowSample = funnelLowSample(totals);
  const max = totals.signalsGenerated;

  return (
    <Surface
      elevation={1}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.cardHeader}>
        {/* UXR L-1 A-7: 섹션 헤딩('신호에서 체결까지')과 수직 중복되던 카드 내부 타이틀 제거 —
            핵심 수치(누적 일수·전환율)를 카드 1행으로 승격. */}
        <View style={styles.titleRow}>
          <Feather name="filter" size={16} color={colors.primary} />
          <Text style={[typo.bodyMedium, { color: colors.text }]}>
            {`누적 ${totals.days}일 · 신호→체결 ${formatRate(totals.conversionRate)}`}
          </Text>
        </View>
      </View>

      {lowSample ? (
        <DataLimitBadge sampleCount={totals.signalsGenerated} style={styles.limitBadge} />
      ) : null}

      <View style={styles.stages}>
        <FunnelStage
          label="생성 신호"
          count={totals.signalsGenerated}
          widthPercent={barWidthPercent(totals.signalsGenerated, max)}
          fillColor={colors.primary}
        />
        <FunnelStage
          label="진입 후보"
          count={totals.candidatesPassed}
          widthPercent={barWidthPercent(totals.candidatesPassed, max)}
          fillColor={colors.primary}
          rateCaption={`채택률 ${formatRate(totals.adoptionRate)}`}
        />
        <FunnelStage
          label="체결"
          count={totals.filled}
          widthPercent={barWidthPercent(totals.filled, max)}
          fillColor={colors.success}
          rateCaption={`체결률 ${formatRate(totals.fillRate)}`}
        />
      </View>

      <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.sm }]}>
        모의운용 누적 측정값 · 실제 주문이 아닙니다(참고용).
      </Text>
    </Surface>
  );
}

function FunnelEmpty() {
  const { colors, typography: typo } = useTheme();
  return (
    <Surface
      elevation={1}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      {/* UXR L-1 A-7: 섹션 헤딩과 중복되던 카드 내부 타이틀 제거 — 빈 상태 안내만 유지. */}
      <Text style={[typo.small, { color: colors.textSecondary }]}>
        아직 집계된 신호가 없습니다. 모의운용 데이터가 쌓이면 전환율이 표시됩니다.
      </Text>
    </Surface>
  );
}

export function EntryFunnelSection() {
  const { colors, typography: typo } = useTheme();
  const { data, isLoading, isError, error, refetch } = useGraduationFunnel();

  const handleRetry = useCallback(() => {
    refetch();
  }, [refetch]);

  let body: React.ReactNode;
  if (isLoading) {
    body = (
      <View style={styles.skeletonWrap} accessibilityRole="progressbar" accessibilityLabel="전환 현황 불러오는 중">
        <SkeletonCard variant="buyScore" />
      </View>
    );
  } else if (isError) {
    body = (
      <ApiErrorState
        error={error}
        onRetry={handleRetry}
        title="전환 현황을 불러오지 못했습니다"
        description="잠시 후 다시 시도해 주세요."
      />
    );
  } else if (data && data.totals.signalsGenerated > 0) {
    body = <FunnelBody report={data} />;
  } else if (data) {
    body = <FunnelEmpty />;
  } else {
    body = null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.heading}>
        {/* UXR L-1 A-7: 카드 타이틀과 다르게 부르던 헤딩('신호가 진입으로')을 '신호에서 체결까지'로 통일. */}
        <Text style={[typo.bodyMedium, { color: colors.text }]}>신호에서 체결까지</Text>
        <Text style={[typo.small, { color: colors.textSecondary }]}>생성 신호 → 진입 후보 → 체결 전환</Text>
      </View>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  heading: {
    gap: 2,
    marginBottom: spacing.md,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
  cardHeader: {
    gap: 2,
    marginBottom: spacing.md,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  limitBadge: {
    marginBottom: spacing.md,
  },
  stages: {
    gap: spacing.md,
  },
  stage: {
    gap: spacing.xs,
  },
  stageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  barTrack: {
    height: 8,
    borderRadius: radius.full,
    overflow: 'hidden',
  },
  barFill: {
    height: 8,
    borderRadius: radius.full,
  },
  skeletonWrap: {
    minHeight: 80,
  },
});
