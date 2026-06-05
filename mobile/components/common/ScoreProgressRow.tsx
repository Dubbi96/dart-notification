import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ProgressBar } from 'react-native-paper';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';

// 점수 기여 1행(기획 §4-1). [라벨] [mini ProgressBar] [부호+점수].
// 가산(+)은 success, 리스크 패널티(-)는 error. 색상 단독 의미 전달 금지 —
// 부호(+/-)·숫자·표본수(n) 텍스트를 항상 병행한다.

interface ScoreProgressRowProps {
  /** 기여 요소명 (예: '공시 이벤트') */
  label: string;
  /** 기여 점수 (양수 가산, 음수 리스크 패널티) */
  score: number;
  /** ProgressBar 최대값 기준 (예: 20) */
  maxContribution: number;
  /** 특이 표시: 'sample'이면 표본수(n) 동반 노출 */
  kind?: 'normal' | 'sample';
  /** eventStudy 표본수 */
  sampleN?: number;
}

export function ScoreProgressRow({
  label,
  score,
  maxContribution,
  kind = 'normal',
  sampleN,
}: ScoreProgressRowProps) {
  const { colors, typography: typo } = useTheme();
  const isPenalty = score < 0;
  const barColor = isPenalty ? colors.error : colors.success;
  const magnitude = Math.abs(score);
  const max = maxContribution > 0 ? maxContribution : 1;
  const progress = Math.max(0, Math.min(1, magnitude / max));
  const signed = `${isPenalty ? '-' : '+'}${magnitude}`;
  const showSample = kind === 'sample' && sampleN !== undefined;
  const sampleText = showSample ? ` (n=${sampleN}건)` : '';

  return (
    <View
      style={styles.row}
      accessibilityRole="text"
      accessibilityLabel={`${label}${sampleText}, ${isPenalty ? '리스크 패널티' : '가산'} ${signed}점`}
    >
      <Text style={[typo.small, { color: colors.textSecondary }, styles.label]} numberOfLines={1}>
        {label}
        {showSample ? (
          <Text style={[typo.small, { color: colors.textTertiary }]}>{sampleText}</Text>
        ) : null}
      </Text>
      <ProgressBar
        progress={progress}
        color={barColor}
        style={[styles.bar, { backgroundColor: colors.surfaceSecondary }]}
      />
      <Text style={[typo.captionMedium, { color: barColor }, styles.score]}>{signed}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
    height: 6,
    borderRadius: 3,
  },
  score: {
    width: 56,
    textAlign: 'right',
  },
});
