import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Surface } from 'react-native-paper';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { ScoreProgressRow } from '@components/common/ScoreProgressRow';
import { isScoreSumMismatch } from '@utils/numberFormat';

// Score 근거 분해 섹션(기획 §4-2). 7개 가산 요소 + 리스크 패널티 + 표본수 동등 노출.
// 과신 역설 차단: 리스크 패널티는 항상 마지막에, 표본수(n)는 양수 기여와 동등 비중으로 표시.
// 합계 = 헤더 점수 증명(합계 꼬리줄). 색상 단독 의미 전달 금지.

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
  /** 헤더 점수와 일치해야 하는 합계 */
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

  // 합계 정합 검사는 헤더(정수 추정)와 같은 자릿수로 반올림 비교(DAR-258).
  // 소수 기여(예: 7.5) 누적의 부동소수 오차로 경고가 오발화하던 문제 차단.
  if (__DEV__ && isScoreSumMismatch(items, totalScore)) {
    const sum = items.reduce((acc, i) => acc + i.score, 0);
    // eslint-disable-next-line no-console
    console.warn(
      `[ScoreBreakdownSection] 합계(${Math.round(sum)}) ≠ 헤더 점수(${totalScore}). 가산식 정합성 확인 필요.`,
    );
  }

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
        <Text style={[typo.bodyMedium, { color: colors.textSecondary }]}>합계</Text>
        <Text style={[typo.bodyMedium, { color: colors.text, fontWeight: '700' }]}>
          {totalScore}점
        </Text>
      </View>
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
