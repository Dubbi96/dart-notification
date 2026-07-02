import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { ProgressBar } from 'react-native-paper';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { EvidenceMeta } from '@components/common/EvidenceMeta';
import type { MetricEvaluation, PhilosophyFitScore } from '@app-types/philosophy.types';
import { metricLabel, formatMetricValue, formatThreshold } from './metricFormat';

// "버핏이라면" 항목별 통과/미달 체크리스트 분해 뷰 (DAR-57, 상용 패널 #4).
// P-B scorer breakdown(MetricEvaluation[])을 종목×철학 체크리스트로 분해 — 점수 1개가 아닌
// 지표별 근거(실제값·기준·achievement)로 판단 밀도↑.
// 규약(DAR-56 EvidenceMeta·과신 방지):
//  - 색 단독 의미 금지: 모든 행은 Feather 아이콘(형태) + 평문 텍스트 라벨 병행.
//  - 통과/미달과 '결측(미평가)'을 분리: 결측은 거짓 0점이 아니라 '평가 못함'으로 명시.
//  - 정성 checklistItems(자동 평가 불가)는 '직접 확인 항목'으로 별도 분리.

interface PhilosophyChecklistProps {
  fit: PhilosophyFitScore;
  /** 정성 체크리스트(자동 평가 불가 — '직접 확인 항목'). Philosophy.checklistItems. */
  checklistItems?: string[];
}

// 행 아이콘 열 지오메트리(L-5b E-1): 본문을 아이콘 아래에 정렬하는 인덴트는
// 아이콘 폭 + rowIcon 우측 여백(spacing.sm)에서 파생한다 — 매직넘버 22 대체.
const ROW_ICON_SIZE = 14;
const ROW_ICON_INDENT = ROW_ICON_SIZE + spacing.sm; // 14 + 8 = 22

function PhilosophyChecklistBase({ fit, checklistItems }: PhilosophyChecklistProps) {
  const { colors, typography: typo } = useTheme();

  const { passed, failed, missing } = useMemo(() => {
    const p: MetricEvaluation[] = [];
    const f: MetricEvaluation[] = [];
    const m: MetricEvaluation[] = [];
    for (const ev of fit.breakdown) {
      if (!ev.available) m.push(ev);
      else if (ev.passed === true) p.push(ev);
      else f.push(ev);
    }
    return { passed: p, failed: f, missing: m };
  }, [fit.breakdown]);

  const passedCount = fit.passedMetricKeys.length;

  return (
    <View>
      {/* 상단 충족도 요약 — '충족도 N점 · M/총 통과' */}
      {fit.computable && fit.score != null ? (
        <View
          style={[styles.summaryCard, { backgroundColor: colors.surfaceSecondary }]}
          accessibilityLabel={`${fit.investorName} 충족도 ${Math.round(fit.score)}점. 전체 ${fit.totalMetrics}개 지표 중 ${passedCount}개 통과, ${failed.length}개 미달, ${missing.length}개 미평가`}
        >
          <View style={styles.summaryHead}>
            <Feather name="check-square" size={16} color={colors.primary} />
            <Text style={[typo.bodyMedium, { color: colors.text, marginLeft: spacing.xs }]}>
              충족도 {Math.round(fit.score)}점
            </Text>
            <Text style={[typo.caption, { color: colors.textSecondary, marginLeft: spacing.sm }]}>
              · {passedCount}/{fit.totalMetrics} 통과
            </Text>
          </View>
          <EvidenceMeta
            coverage={{
              evaluated: fit.evaluatedCount,
              total: fit.totalMetrics,
              omittedLabels: fit.omittedMetricKeys.map(metricLabel),
            }}
            style={styles.summaryEvidence}
          />
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

      {/* 통과 항목 */}
      {passed.length > 0 ? (
        <ChecklistSection
          icon="check-circle"
          color={colors.success}
          title={`통과 ${passed.length}`}
        >
          {passed.map((ev) => (
            <MetricChecklistRow key={ev.metricKey} ev={ev} status="pass" />
          ))}
        </ChecklistSection>
      ) : null}

      {/* 미달 항목 */}
      {failed.length > 0 ? (
        <ChecklistSection
          icon="x-circle"
          color={colors.error}
          title={`미달 ${failed.length}`}
        >
          {failed.map((ev) => (
            <MetricChecklistRow key={ev.metricKey} ev={ev} status="fail" />
          ))}
        </ChecklistSection>
      ) : null}

      {/* 미평가(결측) — 통과/미달과 분리 */}
      {missing.length > 0 ? (
        <ChecklistSection
          icon="help-circle"
          color={colors.textTertiary}
          title={`미평가 ${missing.length}`}
          note="재무 부족·P-C 이후 평가"
        >
          {missing.map((ev) => (
            <MetricChecklistRow key={ev.metricKey} ev={ev} status="missing" />
          ))}
        </ChecklistSection>
      ) : null}

      {/* 직접 확인 항목(정성 — 자동 평가 불가) */}
      {checklistItems && checklistItems.length > 0 ? (
        <ChecklistSection
          icon="edit-3"
          color={colors.primary}
          title="직접 확인 항목"
          note="정성 지표 — 자동 평가 불가, 직접 판단"
        >
          {checklistItems.map((item, idx) => (
            <View
              key={idx}
              style={[styles.qualitativeRow, { borderColor: colors.borderLight }]}
              accessibilityLabel={`직접 확인 항목: ${item}`}
            >
              <Feather name="square" size={ROW_ICON_SIZE} color={colors.textTertiary} style={styles.rowIcon} />
              <Text style={[typo.caption, { color: colors.textSecondary, flex: 1 }]}>{item}</Text>
            </View>
          ))}
        </ChecklistSection>
      ) : null}
    </View>
  );
}

type MetricStatus = 'pass' | 'fail' | 'missing';

function MetricChecklistRow({ ev, status }: { ev: MetricEvaluation; status: MetricStatus }) {
  const { colors, typography: typo } = useTheme();

  const accent =
    status === 'pass' ? colors.success : status === 'fail' ? colors.error : colors.textTertiary;
  const icon: keyof typeof Feather.glyphMap =
    status === 'pass' ? 'check' : status === 'fail' ? 'x' : 'minus';
  const statusText = status === 'pass' ? '통과' : status === 'fail' ? '미달' : '미평가';
  const valueText = status === 'missing' ? '—' : formatMetricValue(ev);
  // achievement 0~1 달성도 막대(결측이면 막대 없음).
  const achievement = ev.achievement == null ? null : Math.max(0, Math.min(1, ev.achievement));

  return (
    <View
      style={[styles.metricRow, { borderColor: colors.borderLight }]}
      accessibilityLabel={`${metricLabel(ev.metricKey)} — ${formatThreshold(ev)} — 실제 ${valueText} — ${statusText}${
        achievement != null ? ` — 달성도 ${Math.round(achievement * 100)}%` : ''
      }`}
    >
      <View style={styles.metricTop}>
        <Feather name={icon} size={ROW_ICON_SIZE} color={accent} style={styles.rowIcon} />
        <View style={styles.metricBody}>
          <Text style={[typo.captionMedium, { color: colors.text }]}>{metricLabel(ev.metricKey)}</Text>
          <Text style={[typo.small, { color: colors.textSecondary }]}>{ev.description}</Text>
        </View>
        <View style={styles.metricValue}>
          <Text style={[typo.captionMedium, { color: accent }]}>{valueText}</Text>
          <Text style={[typo.small, { color: colors.textTertiary }]}>{formatThreshold(ev)}</Text>
        </View>
      </View>

      {achievement != null ? (
        <View style={styles.achievementRow}>
          <ProgressBar
            progress={achievement}
            color={accent}
            style={[styles.achievementBar, { backgroundColor: colors.surfaceSecondary }]}
          />
          <Text style={[typo.small, { color: colors.textTertiary }, styles.achievementPct]}>
            {Math.round(achievement * 100)}%
          </Text>
        </View>
      ) : (
        <Text style={[typo.small, styles.statusOnlyText, { color: colors.textTertiary }]}>
          {statusText === '미평가' ? '재무 데이터 결측 — 달성도 산출 불가' : statusText}
        </Text>
      )}
    </View>
  );
}

function ChecklistSection({
  icon,
  color,
  title,
  note,
  children,
}: {
  icon: keyof typeof Feather.glyphMap;
  color: string;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  const { colors, typography: typo } = useTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Feather name={icon} size={14} color={color} />
        <Text style={[typo.captionMedium, { color: colors.text, marginLeft: spacing.xs }]}>{title}</Text>
        {note ? (
          <Text style={[typo.small, { color: colors.textTertiary, marginLeft: spacing.xs }]}>· {note}</Text>
        ) : null}
      </View>
      <View>{children}</View>
    </View>
  );
}

export const PhilosophyChecklist = React.memo(PhilosophyChecklistBase);

const styles = StyleSheet.create({
  summaryCard: {
    padding: spacing.md,
    borderRadius: radius.md,
  },
  summaryHead: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  summaryEvidence: {
    marginTop: spacing.sm,
  },
  unevaluable: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.sm,
    borderRadius: radius.sm,
  },
  section: {
    marginTop: spacing.lg,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  metricRow: {
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  metricTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  rowIcon: {
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
  achievementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xs,
    marginLeft: ROW_ICON_INDENT,
  },
  statusOnlyText: {
    marginLeft: ROW_ICON_INDENT,
  },
  achievementBar: {
    flex: 1,
    height: 6,
    borderRadius: 3,
  },
  achievementPct: {
    width: 40,
    textAlign: 'right',
  },
  qualitativeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
