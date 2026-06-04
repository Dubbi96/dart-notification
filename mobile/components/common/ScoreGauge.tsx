import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ProgressBar } from 'react-native-paper';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import { buyScoreColor, exitScoreColor } from '@utils/signalDisplay';

// 점수 게이지(기획 §3). RN Paper ProgressBar로 구간별 색상 표시.
// kind에 따라 Buy/Exit 점수 색상 밴드를 적용한다.

interface ScoreGaugeProps {
  /** 0~100 */
  score: number;
  kind?: 'buy' | 'exit';
  /** 좌측 레이블 (예: "Buy Score") */
  label?: string;
  /** 접근성 라벨 보조 텍스트 (예: "강한매수") */
  statusText?: string;
}

export function ScoreGauge({ score, kind = 'buy', label, statusText }: ScoreGaugeProps) {
  const { colors, typography: typo } = useTheme();
  const clamped = Math.max(0, Math.min(100, score));
  const color = kind === 'exit' ? exitScoreColor(clamped, colors) : buyScoreColor(clamped, colors);
  const title = kind === 'exit' ? 'Exit Score' : 'Buy Score';

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={`${label ?? title} ${clamped}${statusText ? `, ${statusText}` : ''}`}
    >
      <View style={styles.row}>
        <Text style={[typo.small, { color: colors.textSecondary }]}>{label ?? title}</Text>
        <Text style={[typo.captionMedium, { color }]}>{clamped}</Text>
      </View>
      <ProgressBar
        progress={clamped / 100}
        color={color}
        style={[styles.bar, { backgroundColor: colors.surfaceSecondary }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  bar: {
    height: 8,
    borderRadius: 4,
  },
});
