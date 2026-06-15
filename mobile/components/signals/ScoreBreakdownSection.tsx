import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Surface } from 'react-native-paper';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { ScoreProgressRow } from '@components/common/ScoreProgressRow';

// Score 근거 분해 섹션(기획 §4-2). 7개 가산 요소 + 리스크 패널티 + 표본수 동등 노출.
// 과신 역설 차단: 리스크 패널티는 항상 마지막에, 표본수(n)는 양수 기여와 동등 비중으로 표시.
// 표시 모델은 '가중 전 원시 기여'(DAR-299). 백엔드 scoreBreakdown 은 가중·정규화 전
// 컴포넌트 기여를 싣고, 헤더 Buy Score 는 가중·클램프·정규화 후 최종값이라 두 값이
// 다를 수 있다(예: 근거합 84 vs 헤더 11). 꼬리줄 '합계'는 표시된 행들의 산술합(=가중 전)
// 을 노출해 행과 정합을 맞추고, 최종 Buy Score 와의 차이는 안내문으로 명시한다.
// 색상 단독 의미 전달 금지.

export interface ScoreBreakdownItem {
  id: string;
  label: string;
  /** 양수 가산 또는 음수 패널티 */
  score: number;
  /** ProgressBar 최대값 기준 (기본 20) */
  maxContribution?: number;
  /** eventStudy 표본수 — 존재 시 라벨 뒤 '(n=N건)' 동반 노출 */
  sampleN?: number;
}

interface ScoreBreakdownSectionProps {
  items: ScoreBreakdownItem[];
  /**
   * 헤더 최종 Buy Score(가중·클램프·정규화 후). 가중 전 근거 합계와 다를 수 있어
   * 꼬리줄 '합계'로 쓰지 않고, 차이가 있을 때 안내문 참조용으로만 노출한다(DAR-299).
   */
  totalScore: number;
}

export function ScoreBreakdownSection({ items, totalScore }: ScoreBreakdownSectionProps) {
  const { colors, typography: typo } = useTheme();

  // 백엔드 미연동(빈 배열) 시 graceful null
  if (!items || items.length === 0) {
    return null;
  }

  // 리스크 패널티(음수)는 항상 마지막에 노출
  const ordered = [...items].sort((a, b) => {
    const aPenalty = a.score < 0 ? 1 : 0;
    const bPenalty = b.score < 0 ? 1 : 0;
    return aPenalty - bPenalty;
  });

  // 가중 전 근거의 산술합(행 라벨과 같은 정수 자릿수로 반올림 — DAR-258).
  // 헤더 Buy Score 는 가중·정규화 후 값이라 이 합과 다를 수 있다(DAR-299).
  // 과거엔 둘이 일치해야 한다는 가정으로 __DEV__ 경고를 띄웠으나, 표시 모델이
  // '가중 전 원시 기여'임을 명시하면 둘의 차이는 정상이므로 경고를 제거한다.
  const rawSum = Math.round(items.reduce((acc, i) => acc + i.score, 0));
  const isWeightedDiff = rawSum !== totalScore;

  return (
    <Surface
      elevation={0}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      <Text style={[typo.captionMedium, { color: colors.textSecondary, marginBottom: spacing.sm }]}>
        ── Score 근거 ──
      </Text>
      {ordered.map((item) => (
        <ScoreProgressRow
          key={item.id}
          label={item.label}
          score={item.score}
          maxContribution={item.maxContribution ?? 20}
          kind={item.sampleN !== undefined ? 'sample' : 'normal'}
          sampleN={item.sampleN}
        />
      ))}
      <View style={[styles.totalRow, { borderTopColor: colors.border }]}>
        <Text style={[typo.bodyMedium, { color: colors.textSecondary }]}>
          합계{isWeightedDiff ? ' (가중 전)' : ''}
        </Text>
        <Text style={[typo.bodyMedium, { color: colors.text, fontWeight: '700' }]}>
          {rawSum}점
        </Text>
      </View>
      {isWeightedDiff ? (
        <Text style={[typo.small, { color: colors.textTertiary, marginTop: spacing.xs }]}>
          최종 Buy Score {totalScore}점은 항목별 가중·정규화를 적용한 값입니다.
        </Text>
      ) : null}
    </Surface>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.base,
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
