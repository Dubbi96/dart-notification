import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Surface, ProgressBar } from 'react-native-paper';
import { useTheme } from '@theme';
import { spacing, radius, progressBar } from '@theme/spacing';

// DAR-470: 기여도 % 값 열의 고정 폭(우측 정렬 정합). 매직넘버 금지 → 명명 상수.
const PCT_COLUMN_WIDTH = 56;

// Score 근거 분해 섹션(기획 §4-2, DAR-447). 7개 가산 요소 + 리스크 패널티 + 표본수 동등 노출.
// 과신 역설 차단: 리스크 패널티는 항상 마지막에, 표본수(n)는 양수 기여와 동등 비중으로 표시.
//
// DAR-447 신뢰 무결성: 백엔드 scoreBreakdown 은 가중·정규화 전 '원시 기여'(예 차트+44,
// 내부자+40=84)를, 헤더 Buy Score 는 가중·클램프·비선형 정규화 후 최종값(예 11)을 싣는다.
// 프런트는 그 비선형 가중식을 알 수 없으므로 항목별 '가중 후 점수'를 진실하게 복원할 수 없다.
// 따라서 과거처럼 원시 합(84)을 '합계'로 노출하면 헤더(11)와 정면 모순돼 신뢰를 깬다.
// → 항목은 '양의 근거 대비 상대 기여도(%)'로 정규화(어떤 가중식과도 무관하게 참)하고,
//   유일한 절대 점수는 헤더와 동일한 최종 Buy Score 한 값만 노출해 합계 모순을 제거한다.
// 색상 단독 의미 전달 금지 — 부호·숫자·라벨을 항상 병행한다.

export interface ScoreBreakdownItem {
  id: string;
  label: string;
  /** 양수 가산 또는 음수 패널티(가중 전 원시 기여) */
  score: number;
  /** 표시 모델이 상대 기여도(%)로 바뀌어 더는 사용하지 않음(호출부 호환 위해 유지) */
  maxContribution?: number;
  /** eventStudy 표본수 — 존재 시 라벨 뒤 '(n=N건)' 동반 노출 */
  sampleN?: number;
}

interface ScoreBreakdownSectionProps {
  items: ScoreBreakdownItem[];
  /** 헤더 최종 Buy Score(가중·클램프·정규화 후). 섹션의 유일한 절대 점수로 노출(DAR-447). */
  totalScore: number;
}

export interface ScoreContribution extends ScoreBreakdownItem {
  /** 양의 근거 합 대비 상대 기여도(%). 가산=양수, 패널티=음수. 양의 근거 0이면 null. */
  pct: number | null;
  isPenalty: boolean;
}

/**
 * 표시 모델 산출(DAR-447). 항목을 '양의 근거 합 대비 상대 기여도(%)'로 정규화한다.
 * 가중식과 무관하게 참인 값이라 헤더 최종 Buy Score 와 모순을 만들지 않는다.
 * 패널티(음수)는 항상 마지막 순서로 정렬한다.
 */
export function computeScoreContributions(
  items: ReadonlyArray<ScoreBreakdownItem>,
): ScoreContribution[] {
  const grossPositive = items.reduce((acc, i) => (i.score > 0 ? acc + i.score : acc), 0);
  const withPct: ScoreContribution[] = items.map((item) => ({
    ...item,
    isPenalty: item.score < 0,
    pct: grossPositive > 0 ? Math.round((item.score / grossPositive) * 100) : null,
  }));
  // 리스크 패널티(음수)는 항상 마지막에 노출(과신 역설 차단).
  return withPct.sort((a, b) => (a.isPenalty ? 1 : 0) - (b.isPenalty ? 1 : 0));
}

function ContributionRow({ item }: { item: ScoreContribution }) {
  const { colors, typography: typo } = useTheme();
  const barColor = item.isPenalty ? colors.error : colors.success;
  const progress = item.pct === null ? 0 : Math.min(1, Math.abs(item.pct) / 100);
  // 부호 병행 표기(색상 단독 금지): 패널티는 '−', 미산정은 '—'.
  const pctText =
    item.pct === null ? '—' : item.isPenalty ? `−${Math.abs(item.pct)}%` : `${item.pct}%`;
  const sampleText = item.sampleN !== undefined ? ` (n=${item.sampleN}건)` : '';
  return (
    <View
      style={styles.row}
      accessibilityRole="text"
      accessibilityLabel={`${item.label}${sampleText}, ${
        item.isPenalty ? '리스크 차감' : '기여도'
      } ${pctText}`}
    >
      <Text style={[typo.small, { color: colors.textSecondary }, styles.label]} numberOfLines={1}>
        {item.label}
        {sampleText ? (
          <Text style={[typo.small, { color: colors.textTertiary }]}>{sampleText}</Text>
        ) : null}
      </Text>
      <ProgressBar
        progress={progress}
        color={barColor}
        style={[styles.bar, { backgroundColor: colors.surfaceSecondary }]}
      />
      <Text style={[typo.captionMedium, { color: barColor }, styles.pct]}>{pctText}</Text>
    </View>
  );
}

export function ScoreBreakdownSection({ items, totalScore }: ScoreBreakdownSectionProps) {
  const { colors, typography: typo } = useTheme();

  // 백엔드 미연동(빈 배열) 시 graceful null
  if (!items || items.length === 0) {
    return null;
  }

  const contributions = computeScoreContributions(items);

  return (
    <Surface
      elevation={0}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Text style={[typo.captionMedium, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
        Score 근거
      </Text>
      {contributions.map((item) => (
        <ContributionRow key={item.id} item={item} />
      ))}
      {/* DAR-447: 유일한 절대 점수 = 헤더와 동일한 최종 Buy Score. '합계' 모순 제거. */}
      <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
        <Text style={[typo.bodyMedium, { color: colors.textSecondary }]}>최종 Buy Score</Text>
        <Text style={[typo.bodyMedium, { color: colors.text, fontWeight: '700' }]}>
          {totalScore}점
        </Text>
      </View>
      <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.xs }]}>
        각 항목은 양의 근거 대비 상대 기여도입니다. 최종 Buy Score는 항목별 가중·정규화를 반영한
        값입니다.
      </Text>
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  label: {
    flex: 1.2,
  },
  bar: {
    flex: 1,
    height: progressBar.height,
    borderRadius: progressBar.radius,
  },
  pct: {
    width: PCT_COLUMN_WIDTH,
    textAlign: 'right',
  },
  totalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
  },
});
