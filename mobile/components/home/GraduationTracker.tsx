import React, { useCallback } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Surface } from 'react-native-paper';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { ApiErrorState } from '@components/common/StateView';
import { SkeletonCard } from '@components/common/SkeletonCard';
import { useGraduationMetrics } from '@hooks/useGraduationMetrics';
import { EntryFunnelSection } from '@components/home/EntryFunnelSection';

import type { GraduationGate, GraduationReport } from '@app-types/graduation.types';

// 홈 '졸업 트래커' 카드(DAR-67, 상용 패널 v2 #2).
// ★Main Thesis B 결승선(M10 졸업 측정): 게이트 G1~G5 현재값 vs 기준 · 통과/미달 배지 · 진척률을
// 한눈에. 표본 부족(LOW_SAMPLE)은 '표본 부족' 투명 배지로 정직 표기(과신 방지).
// 테마 토큰만 사용·하드코딩 색상 0·접근성 라벨. 측정값은 참고용(면책 유지).

type BadgeKind = 'pass' | 'fail' | 'lowSample' | 'unmeasurable';

function badgeKind(gate: GraduationGate): BadgeKind {
  if (gate.pass === true) return 'pass';
  if (gate.pass === false) return 'fail';
  if (gate.lowSample) return 'lowSample';
  return 'unmeasurable';
}

const BADGE_TEXT: Record<BadgeKind, string> = {
  pass: '통과',
  fail: '미달',
  lowSample: '표본 부족',
  unmeasurable: '측정 불가',
};

/** 현재값 표기 — percent: '60%', ratio: '0.10'. 측정 불가/표본 부족이면 '—' */
function formatCurrent(gate: GraduationGate): string {
  if (gate.currentValue === null) return '—';
  if (gate.unit === 'percent') {
    const sign = gate.comparator === 'gt' && gate.currentValue >= 0 ? '+' : '';
    return `${sign}${Math.round(gate.currentValue)}%`;
  }
  return gate.currentValue.toFixed(2);
}

/** 기준 표기 — '≥ 55%', '> 0%', '≤ 0.20' */
function formatThreshold(gate: GraduationGate): string {
  const op = gate.comparator === 'gte' ? '≥' : gate.comparator === 'gt' ? '>' : '≤';
  const val = gate.unit === 'percent' ? `${gate.threshold}%` : gate.threshold.toFixed(2);
  return `${op} ${val}`;
}

function GateRow({ gate }: { gate: GraduationGate }) {
  const { colors, typography: typo } = useTheme();
  const kind = badgeKind(gate);

  // 배지 색상 — 테마 토큰만(하드코딩 0).
  const badgeColor =
    kind === 'pass' ? colors.success : kind === 'fail' ? colors.error : colors.textTertiary;
  const badgeBg =
    kind === 'pass'
      ? colors.successSurface
      : kind === 'fail'
        ? colors.surfaceSecondary
        : colors.surfaceSecondary;

  const sampleSuffix = gate.sampleSize !== null ? ` · n=${gate.sampleSize}` : '';

  return (
    <View
      style={styles.gateRow}
      accessibilityRole="text"
      accessibilityLabel={`${gate.label}, 현재 ${formatCurrent(gate)}, 기준 ${formatThreshold(
        gate,
      )}, ${BADGE_TEXT[kind]}${gate.sampleSize !== null ? `, 표본 ${gate.sampleSize}건` : ''}`}
    >
      <View style={styles.gateInfo}>
        <Text style={[typo.captionMedium, { color: colors.text }]} numberOfLines={1}>
          {gate.label}
        </Text>
        <Text style={[typo.small, { color: colors.textSecondary }]}>
          {formatCurrent(gate)}
          <Text style={{ color: colors.textTertiary }}>{`  (기준 ${formatThreshold(gate)})${sampleSuffix}`}</Text>
        </Text>
      </View>
      <View
        style={[styles.badge, { backgroundColor: badgeBg, borderColor: badgeColor }]}
        importantForAccessibility="no-hide-descendants"
      >
        <Text style={[typo.small, { color: badgeColor, fontWeight: '700' }]}>{BADGE_TEXT[kind]}</Text>
      </View>
    </View>
  );
}

function TrackerBody({ report }: { report: GraduationReport }) {
  const { colors, typography: typo } = useTheme();
  return (
    <Surface
      elevation={1}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <View style={styles.cardHeader}>
        <View style={styles.headerText}>
          <View style={styles.titleRow}>
            <Feather name="award" size={16} color={colors.primary} />
            <Text style={[typo.bodyMedium, { color: colors.text }]}>졸업 트래커</Text>
            {report.lowSample ? (
              <View
                style={[styles.lowSampleBadge, { borderColor: colors.border }]}
                accessibilityLabel="표본 부족 — 일부 지표는 데이터가 더 쌓여야 합니다"
              >
                <Text style={[typo.small, { color: colors.textTertiary }]}>표본 부족</Text>
              </View>
            ) : null}
          </View>
          <Text style={[typo.small, { color: colors.textSecondary }]}>
            졸업 게이트 {report.passedCount}/{report.totalGates} 통과
          </Text>
        </View>
      </View>

      {/* 진척 막대 — passedCount/totalGates 비율(테마 토큰만) */}
      <View
        style={[styles.progressTrack, { backgroundColor: colors.surfaceSecondary }]}
        accessibilityRole="progressbar"
        accessibilityLabel={`졸업 진척 ${Math.round(report.progress * 100)}퍼센트`}
      >
        <View
          style={[
            styles.progressFill,
            {
              backgroundColor: report.allPassed ? colors.success : colors.primary,
              width: `${Math.round(report.progress * 100)}%`,
            },
          ]}
        />
      </View>

      <View style={styles.gateList}>
        {report.gates.map((g) => (
          <GateRow key={g.id} gate={g} />
        ))}
      </View>

      {/* Sharpe 참고지표(통과/미달 게이트 아님) — DAR-68. 측정 불가면 '—'. */}
      <View
        style={[styles.sharpeRow, { borderTopColor: colors.border }]}
        accessibilityRole="text"
        accessibilityLabel={`위험조정 수익(Sharpe 비율) ${
          report.sharpe !== null ? report.sharpe.toFixed(2) : '측정 불가'
        }, 참고지표`}
      >
        <Text style={[typo.small, { color: colors.textSecondary }]}>
          위험조정 수익(Sharpe)
        </Text>
        <Text style={[typo.captionMedium, { color: colors.text }]}>
          {report.sharpe !== null ? report.sharpe.toFixed(2) : '—'}
          <Text style={[typo.small, { color: colors.textTertiary }]}>{'  참고'}</Text>
        </Text>
      </View>

      <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.sm }]}>
        모의운용 누적 측정값 · 실제 주문이 아닙니다(참고용).
      </Text>
    </Surface>
  );
}

export function GraduationTracker() {
  const { colors, typography: typo } = useTheme();
  const { data, isLoading, isError, error, refetch } = useGraduationMetrics();

  const Heading = (
    <View style={styles.heading}>
      <Text style={[typo.bodyMedium, { color: colors.text }]}>졸업 진척</Text>
      <Text style={[typo.small, { color: colors.textSecondary }]}>Main Thesis B 결승선(M10) 측정</Text>
    </View>
  );

  const handleRetry = useCallback(() => {
    refetch();
  }, [refetch]);

  let body: React.ReactNode;
  if (isLoading) {
    body = (
      <View style={styles.skeletonWrap} accessibilityRole="progressbar" accessibilityLabel="졸업 진척 불러오는 중">
        <SkeletonCard variant="buyScore" />
      </View>
    );
  } else if (isError) {
    body = (
      <ApiErrorState
        error={error}
        onRetry={handleRetry}
        title="졸업 진척을 불러오지 못했습니다"
        description="잠시 후 다시 시도해 주세요."
      />
    );
  } else if (data) {
    body = <TrackerBody report={data} />;
  } else {
    body = null;
  }

  return (
    <View>
      <View style={styles.container}>
        {Heading}
        {body}
      </View>
      {/* 신호→진입 퍼널(DAR-162) — 졸업 트래커 하위 카드. 자체 쿼리·로딩/에러/빈 상태 독립. */}
      <EntryFunnelSection />
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  lowSampleBadge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  progressTrack: {
    height: 6,
    borderRadius: radius.full,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  progressFill: {
    height: 6,
    borderRadius: radius.full,
  },
  gateList: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  sharpeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  gateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  gateInfo: {
    flex: 1,
    gap: 2,
  },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
  },
  skeletonWrap: {
    minHeight: 80,
  },
});
