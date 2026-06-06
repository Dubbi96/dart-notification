import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { SignalMiniGauge } from '@components/signals/SignalMiniGauge';
import { EvidenceMeta } from '@components/common/EvidenceMeta';
import type { PhilosophyFitScore } from '@app-types/philosophy.types';
import { metricLabel, formatMetricValue, formatThreshold } from './metricFormat';

// 철학 1종 × 종목 적합도 분해(DAR-54) — 점수 게이지 + 항목별 통과/미달 근거.
// SignalMiniGauge 재사용(점수 0~100). 색 단독 의미 금지 → 아이콘 형태 + 텍스트 라벨 병행.
// computable=false(재무만으로 평가 불가)는 '평가 불가'로 명시(거짓 0점 노출 방지).

interface PhilosophyFitBreakdownProps {
  fit: PhilosophyFitScore;
  /** 항목별 분해 표시 여부(목록 카드에선 false로 요약만) */
  showBreakdown?: boolean;
}

function PhilosophyFitBreakdownBase({ fit, showBreakdown = true }: PhilosophyFitBreakdownProps) {
  const { colors, typography: typo } = useTheme();
  const evaluated = fit.breakdown.filter((b) => b.available);

  return (
    <View>
      {/* 점수 요약 */}
      {fit.computable && fit.score != null ? (
        <View
          style={styles.scoreRow}
          accessibilityLabel={`${fit.investorName} 적합도 ${Math.round(fit.score)}점. 통과 ${fit.passedMetricKeys.length}개, 미달 ${fit.failedMetricKeys.length}개`}
        >
          <View style={styles.gaugeWrap}>
            <SignalMiniGauge score={fit.score} />
          </View>
        </View>
      ) : (
        <View
          style={[styles.unevaluable, { backgroundColor: colors.surfaceSecondary }]}
          accessibilityLabel={`${fit.investorName} — 현재 재무로 평가 불가`}
        >
          <Feather name="help-circle" size={14} color={colors.textTertiary} />
          <Text style={[typo.small, { color: colors.textSecondary, marginLeft: spacing.xs, flex: 1 }]}>
            현재 재무 데이터만으로는 평가할 수 없는 철학입니다(성장·모멘텀·수급 지표 필요).
          </Text>
        </View>
      )}

      {/* 통과/미달 요약 칩 */}
      {fit.computable ? (
        <View style={styles.summaryRow}>
          <SummaryChip
            icon="check-circle"
            label={`통과 ${fit.passedMetricKeys.length}`}
            color={colors.success}
            typo={typo}
          />
          <SummaryChip
            icon="x-circle"
            label={`미달 ${fit.failedMetricKeys.length}`}
            color={colors.error}
            typo={typo}
          />
        </View>
      ) : null}

      {/* 근거·커버리지 통일 표기(DAR-56) — 'N개 지표 중 M개 평가' + 결측 명시 */}
      {fit.computable ? (
        <EvidenceMeta
          coverage={{
            evaluated: fit.evaluatedCount,
            total: fit.totalMetrics,
            omittedLabels: showBreakdown ? fit.omittedMetricKeys.map(metricLabel) : undefined,
          }}
          style={styles.evidence}
        />
      ) : null}

      {/* 항목별 근거 */}
      {showBreakdown && evaluated.length > 0 ? (
        <View style={styles.breakdownList}>
          {evaluated.map((ev) => {
            const ok = ev.passed === true;
            const accent = ok ? colors.success : colors.error;
            return (
              <View
                key={ev.metricKey}
                style={[styles.metricRow, { borderColor: colors.borderLight }]}
                accessibilityLabel={`${formatThreshold(ev)} — 실제 ${formatMetricValue(ev)} — ${ok ? '통과' : '미달'}`}
              >
                <Feather
                  name={ok ? 'check' : 'x'}
                  size={14}
                  color={accent}
                  style={styles.metricIcon}
                />
                <View style={styles.metricBody}>
                  <Text style={[typo.captionMedium, { color: colors.text }]}>
                    {metricLabel(ev.metricKey)}
                  </Text>
                  <Text style={[typo.small, { color: colors.textSecondary }]}>
                    {ev.description}
                  </Text>
                </View>
                <View style={styles.metricValue}>
                  <Text style={[typo.captionMedium, { color: accent }]}>
                    {formatMetricValue(ev)}
                  </Text>
                  <Text style={[typo.small, { color: colors.textTertiary }]}>
                    {formatThreshold(ev)}
                  </Text>
                </View>
              </View>
            );
          })}
        </View>
      ) : null}

    </View>
  );
}

function SummaryChip({
  icon,
  label,
  color,
  typo,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  color: string;
  typo: { small: object };
}) {
  return (
    <View style={styles.summaryChip}>
      <Feather name={icon} size={13} color={color} />
      <Text style={[typo.small, { color }]}>{label}</Text>
    </View>
  );
}

export const PhilosophyFitBreakdown = React.memo(PhilosophyFitBreakdownBase);

const styles = StyleSheet.create({
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  gaugeWrap: {
    flex: 1,
  },
  unevaluable: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.sm,
    borderRadius: radius.sm,
  },
  summaryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.sm,
  },
  evidence: {
    marginTop: spacing.sm,
  },
  summaryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  breakdownList: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  metricIcon: {
    marginTop: 2,
    marginRight: spacing.sm,
  },
  metricBody: {
    flex: 1,
    paddingRight: spacing.sm,
  },
  metricValue: {
    alignItems: 'flex-end',
    minWidth: 64,
  },
});
