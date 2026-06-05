import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ProgressBar } from 'react-native-paper';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import {
  buyScoreColor,
  exitScoreColor,
  nextCutGap,
  BUY_SCORE_CUTS,
  EXIT_SCORE_CUTS,
} from '@utils/signalDisplay';

// 점수 게이지(기획 §3·§5). RN Paper ProgressBar 위에 등급 밴드 컷 틱 + 현재값 노브를
// 얹어 "78점이 어느 등급 구간인지" 시각화한다. 색상 단독 금지 — 숫자·캡션 병행.

interface ScoreGaugeProps {
  /** 0~100 */
  score: number;
  kind?: 'buy' | 'exit';
  /** 좌측 레이블 (예: "Buy Score") */
  label?: string;
  /** 접근성 라벨 보조 텍스트 (예: "강한매수") */
  statusText?: string;
  /** 점수 아래 1줄 평문 (항상 '(참고)' 포함, utils/copy.ts 기준) */
  oneLiner?: string;
  /** 상위 카드가 합성 읽기를 담당할 때 true → 게이지 자체는 접근성에서 숨김(§8-3) */
  accessibilityHidden?: boolean;
}

export function ScoreGauge({
  score,
  kind = 'buy',
  label,
  statusText,
  oneLiner,
  accessibilityHidden = false,
}: ScoreGaugeProps) {
  const { colors, typography: typo } = useTheme();
  const clamped = Math.max(0, Math.min(100, score));
  const color = kind === 'exit' ? exitScoreColor(clamped, colors) : buyScoreColor(clamped, colors);
  const title = kind === 'exit' ? 'Exit Score' : 'Buy Score';
  const cuts = kind === 'exit' ? EXIT_SCORE_CUTS : BUY_SCORE_CUTS;
  const nextGap = nextCutGap(clamped, kind);

  // 다음 등급까지 N (캡션·접근성 공용). nextGap은 '+2' 형태.
  const nextGapValue = nextGap ? nextGap.replace('+', '') : null;

  return (
    <View
      accessibilityRole={accessibilityHidden ? undefined : 'progressbar'}
      accessibilityElementsHidden={accessibilityHidden}
      importantForAccessibility={accessibilityHidden ? 'no-hide-descendants' : 'auto'}
      accessibilityLabel={
        accessibilityHidden
          ? undefined
          : `${label ?? title} ${clamped}점${statusText ? `, ${statusText} 구간` : ''}${
              nextGapValue ? `, 다음 등급까지 ${nextGapValue}` : ''
            }${oneLiner ? `, ${oneLiner}` : ''}`
      }
    >
      <View style={styles.row}>
        <Text style={[typo.small, { color: colors.textSecondary }]}>{label ?? title}</Text>
        <Text style={[typo.captionMedium, { color }]}>{clamped}</Text>
      </View>

      {/* 바 + 등급 컷 틱 + 노브 (position:relative 컨테이너) */}
      <View style={styles.gaugeArea}>
        <ProgressBar
          progress={clamped / 100}
          color={color}
          style={[styles.bar, { backgroundColor: colors.surfaceSecondary }]}
        />
        {/* 등급 컷 틱 — background 색 세로 구분선으로 등급 경계 표시 */}
        {cuts.map((cut) => (
          <View
            key={cut}
            pointerEvents="none"
            style={[styles.tick, { left: `${cut}%`, backgroundColor: colors.background }]}
          />
        ))}
        {/* 현재 점수 노브 */}
        <View
          pointerEvents="none"
          style={[styles.knob, { left: `${clamped}%`, backgroundColor: color }]}
        />
      </View>

      {/* '다음 등급까지 +N' 캡션 — 우측 정렬, 색상 외 텍스트 신호 */}
      {nextGap ? (
        <View style={styles.captionRow}>
          <Text style={[typo.small, { color: colors.textSecondary }]}>다음 등급까지 {nextGap}</Text>
        </View>
      ) : null}

      {oneLiner ? (
        <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.xs }]}>
          {oneLiner}
        </Text>
      ) : null}
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
  gaugeArea: {
    position: 'relative',
    justifyContent: 'center',
  },
  bar: {
    height: 8,
    borderRadius: 4,
  },
  tick: {
    position: 'absolute',
    top: 0,
    width: 1,
    height: 8,
  },
  knob: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: -5, // 노브 중심을 현재값에 정렬
    marginTop: -1, // 바 중앙 정렬
  },
  captionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: spacing.xs,
  },
});
