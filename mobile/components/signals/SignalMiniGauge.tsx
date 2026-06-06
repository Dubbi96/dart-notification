import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '@theme';
import { spacing, radius } from '@theme/spacing';
import { buyScoreColor, BUY_SCORE_CUTS } from '@utils/signalDisplay';

// 탐색 카드용 점수 미니 게이지(DAR-46) — ScoreGauge의 등급밴드 컷(BUY_SCORE_CUTS)을 재사용해
// "이 점수가 어느 등급 구간인지"를 한 줄로 시각화한다. 리스트 성능을 위해 애니메이션 없는 정적 바.
// 색 단독 의미 전달 금지(§8): 숫자 라벨을 항상 병행하고, 상위 카드가 합성 읽기를 담당하므로 자체는 접근성 숨김.

interface SignalMiniGaugeProps {
  /** 0~100 (음수/초과는 클램프) */
  score: number;
}

function SignalMiniGaugeBase({ score }: SignalMiniGaugeProps) {
  const { colors, typography: typo } = useTheme();
  const clamped = Math.max(0, Math.min(100, score));
  const color = buyScoreColor(clamped, colors);

  return (
    <View style={styles.row} importantForAccessibility="no-hide-descendants">
      <View style={[styles.track, { backgroundColor: colors.surfaceSecondary }]}>
        {/* 채움 바 */}
        <View
          style={[styles.fill, { width: `${clamped}%`, backgroundColor: color }]}
        />
        {/* 등급 경계 틱 — BUY_SCORE_CUTS(30/60/80) 위치에 표시 */}
        {BUY_SCORE_CUTS.map((cut) => (
          <View
            key={cut}
            style={[styles.tick, { left: `${cut}%`, backgroundColor: colors.border }]}
          />
        ))}
      </View>
      <Text style={[typo.captionMedium, { color, minWidth: 26, textAlign: 'right' }]}>
        {clamped}
      </Text>
    </View>
  );
}

export const SignalMiniGauge = React.memo(SignalMiniGaugeBase);

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  track: {
    flex: 1,
    height: 8,
    borderRadius: radius.full,
    overflow: 'hidden',
    position: 'relative',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: radius.full,
  },
  tick: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
  },
});
