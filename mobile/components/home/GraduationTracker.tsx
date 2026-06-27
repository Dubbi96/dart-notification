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
import { CollapsibleCard } from '@components/common/CollapsibleCard';
import { pickNextGate } from '@utils/graduation';

import type { GraduationGate, GraduationReport } from '@app-types/graduation.types';

// 홈 '운용 성과' 카드(DAR-67, 상용 패널 v2 #2).
// DAR-446(A-HOME-1): UI 문구에서 내부·전문 용어(Main Thesis/M10/Sharpe/졸업) 제거 →
//   '운용 성과'·'목표 달성'·'위험 대비 수익' 등 평이어로 치환(신규 사용자 이질감 해소).
// 모의 운용 목표 기준(현재값 vs 기준 · 달성/미달 배지 · 달성률)을 한눈에.
//   표본 부족(LOW_SAMPLE)은 '표본 부족' 투명 배지로 정직 표기(과신 방지).
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

/** 다음 목표 한 줄 요약(미달/미측정 1개). 전부 달성이면 '모든 목표 달성' 라인. */
function NextGateSummary({ report }: { report: GraduationReport }) {
  const { colors, typography: typo } = useTheme();
  const gate = pickNextGate(report);

  if (!gate) {
    return (
      <Text
        style={[typo.small, { color: colors.success, marginTop: spacing.md }]}
        accessibilityRole="text"
        accessibilityLabel="모든 목표 달성"
      >
        모든 목표 달성
      </Text>
    );
  }

  const kind = badgeKind(gate);
  return (
    <View
      style={[styles.nextGateRow, { borderTopColor: colors.border }]}
      accessibilityRole="text"
      accessibilityLabel={`다음 목표 ${gate.label}, 현재 ${formatCurrent(gate)}, 기준 ${formatThreshold(
        gate,
      )}, ${BADGE_TEXT[kind]}`}
    >
      <Text style={[typo.small, styles.nextGateLabel, { color: colors.text }]} numberOfLines={1}>
        <Text style={{ color: colors.textTertiary }}>다음 목표  </Text>
        {gate.label}
      </Text>
      <Text style={[typo.captionMedium, { color: colors.text }]} numberOfLines={1}>
        {formatCurrent(gate)}
        <Text style={[typo.small, { color: colors.textTertiary }]}>{`  (기준 ${formatThreshold(gate)})`}</Text>
      </Text>
    </View>
  );
}

function TrackerBody({ report }: { report: GraduationReport }) {
  const { colors, typography: typo } = useTheme();
  return (
    <View style={styles.bodyWrap}>
      {/* 홈 요약 — 진척바 + 통과 카운트 + 다음 게이트 1개(과밀 해소·DAR-197). */}
      <Surface
        elevation={1}
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        <View style={styles.cardHeader}>
          <View style={styles.headerText}>
            <View style={styles.titleRow}>
              <Feather name="award" size={16} color={colors.primary} />
              <Text style={[typo.bodyMedium, { color: colors.text }]}>운용 성과</Text>
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
              목표 {report.passedCount}/{report.totalGates} 달성
            </Text>
          </View>
        </View>

        {/* 진척 막대 — passedCount/totalGates 비율(테마 토큰만) */}
        <View
          style={[styles.progressTrack, { backgroundColor: colors.surfaceSecondary }]}
          accessibilityRole="progressbar"
          accessibilityLabel={`목표 달성률 ${Math.round(report.progress * 100)}퍼센트`}
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

        <NextGateSummary report={report} />
      </Surface>

      {/* 항목별 표·위험 대비 수익·면책은 opt-in 접기로(progressive disclosure·DAR-197). */}
      <CollapsibleCard
        icon="list"
        title="세부 지표"
        summary={`${report.totalGates}개 지표${
          report.sharpe !== null ? ` · 위험 대비 수익 ${report.sharpe.toFixed(2)}` : ''
        }`}
      >
        <View style={styles.gateList}>
          {report.gates.map((g) => (
            <GateRow key={g.id} gate={g} />
          ))}
        </View>

        {/* 위험 대비 수익 참고지표(달성/미달 항목 아님) — DAR-68. 측정 불가면 '—'. */}
        <View
          style={[styles.sharpeRow, { borderTopColor: colors.border }]}
          accessibilityRole="text"
          accessibilityLabel={`위험 대비 수익 ${
            report.sharpe !== null ? report.sharpe.toFixed(2) : '측정 불가'
          }, 참고지표`}
        >
          <Text style={[typo.small, { color: colors.textSecondary }]}>
            위험 대비 수익
          </Text>
          <Text style={[typo.captionMedium, { color: colors.text }]}>
            {report.sharpe !== null ? report.sharpe.toFixed(2) : '—'}
            <Text style={[typo.small, { color: colors.textTertiary }]}>{'  참고'}</Text>
          </Text>
        </View>

        <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.sm }]}>
          모의운용 누적 측정값 · 실제 주문이 아닙니다(참고용).
        </Text>
      </CollapsibleCard>
    </View>
  );
}

export function GraduationTracker() {
  const { colors, typography: typo } = useTheme();
  const { data, isLoading, isError, error, refetch } = useGraduationMetrics();

  const Heading = (
    <View style={styles.heading}>
      <Text style={[typo.bodyMedium, { color: colors.text }]}>운용 성과</Text>
      <Text style={[typo.small, { color: colors.textSecondary }]}>모의 운용 누적 성과 측정값 (참고)</Text>
    </View>
  );

  const handleRetry = useCallback(() => {
    refetch();
  }, [refetch]);

  let body: React.ReactNode;
  if (isLoading) {
    body = (
      <View style={styles.skeletonWrap} accessibilityRole="progressbar" accessibilityLabel="운용 성과 불러오는 중">
        <SkeletonCard variant="buyScore" />
      </View>
    );
  } else if (isError) {
    body = (
      <ApiErrorState
        error={error}
        onRetry={handleRetry}
        title="운용 성과를 불러오지 못했습니다"
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
      {/* 신호에서 체결까지(DAR-162) — 운용 성과 하위 카드. 자체 쿼리·로딩/에러/빈 상태 독립. */}
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
  bodyWrap: {
    gap: spacing.md,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
  nextGateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  nextGateLabel: {
    flex: 1,
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
