import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { ProgressBar } from 'react-native-paper';
import { useTheme } from '@theme';
import { spacing, gauge } from '@theme/spacing';
import { useReducedMotion } from '@hooks/useReducedMotion';
import {
  buyScoreColor,
  exitScoreColor,
  nextCutGap,
  BUY_SCORE_CUTS,
  EXIT_SCORE_CUTS,
} from '@utils/signalDisplay';

// 점수 게이지(기획 §3·§5·§11). RN Paper ProgressBar 위에 등급 밴드 컷 틱 + 현재값 노브를
// 얹어 "78점이 어느 등급 구간인지" 시각화한다. 색상 단독 금지 — 숫자·캡션 병행.
// 진입 시 0→점수 카운트업 1회(§11): 600ms·ease-out·루프/펄스 금지, reduce-motion 시 즉시 정적.

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
  /** 카운트업 모션(§11). 기본 true=ON. reduce-motion 시 prop 무관하게 즉시 정적 */
  animated?: boolean;
}

export function ScoreGauge({
  score,
  kind = 'buy',
  label,
  statusText,
  oneLiner,
  accessibilityHidden = false,
  animated = true,
}: ScoreGaugeProps) {
  const { colors, typography: typo } = useTheme();
  const clamped = Math.max(0, Math.min(100, score));
  const color = kind === 'exit' ? exitScoreColor(clamped, colors) : buyScoreColor(clamped, colors);
  const title = kind === 'exit' ? 'Exit Score' : 'Buy Score';
  const cuts = kind === 'exit' ? EXIT_SCORE_CUTS : BUY_SCORE_CUTS;
  const nextGap = nextCutGap(clamped, kind);

  // 다음 등급까지 N (캡션·접근성 공용). nextGap은 '+2' 형태.
  const nextGapValue = nextGap ? nextGap.replace('+', '') : null;

  // 카운트업(§11): 숫자·바·노브만 0→clamped 1회 이동. 색/접근성/캡션은 최종값 고정(밴드 색 깜빡임 방지).
  const reducedMotion = useReducedMotion();
  const shouldAnimate = animated && !reducedMotion;
  const [displayScore, setDisplayScore] = useState(0);
  // Animated.Value를 state 지연 초기화로 보관 — 렌더 중 ref 접근 없이 안정 인스턴스 확보.
  const [animValue] = useState(() => new Animated.Value(0));

  useEffect(() => {
    // 표시값은 항상 리스너(비동기)로만 갱신. reduce-motion/animated=false → duration 0(즉시 최종값).
    // deps가 안정적이라 일반 리렌더로는 재실행되지 않음 → 카운트업 1회. reduce-motion이
    // 진입 직후 true로 바뀌면 effect가 재실행되며 즉시 최종값으로 스냅(폴백 의무, §11).
    const id = animValue.addListener(({ value }) => setDisplayScore(Math.round(value)));
    const animation = Animated.timing(animValue, {
      toValue: clamped,
      duration: shouldAnimate ? 600 : 0,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    animation.start();
    return () => {
      animValue.removeListener(id);
      animation.stop();
    };
  }, [shouldAnimate, clamped, animValue]);

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
        {/* DAR-143: 카드 주인공인 점수값을 h2(22px/700)로 승격 — 좌측 라벨(small 12px) 대비
            명확한 타이포 위계 확보. 색상은 buy/exit 등급 로직(color) 유지(하드코딩 금지). */}
        <Text style={[typo.h2, { color }]}>{displayScore}</Text>
      </View>

      {/* 바 + 등급 컷 틱 + 노브 (position:relative 컨테이너).
          DAR-174: 게이지 영역은 고정 픽셀 높이(gauge.barHeight) + 퍼센트 left 기반이라 OS 글꼴
          확대와 독립적이다. 위 점수 숫자(h2)가 커져도 게이지 내부 틱/노브 정렬은 틀어지지 않는다. */}
      <View style={styles.gaugeArea}>
        <ProgressBar
          progress={displayScore / 100}
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
        {/* 현재 점수 노브 — 카운트업과 함께 이동 */}
        <View
          pointerEvents="none"
          style={[styles.knob, { left: `${displayScore}%`, backgroundColor: color }]}
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

// DAR-174: 게이지 영역 높이 = knobSize. 막대(barHeight)는 영역 세로 중앙에 놓이므로
// 막대/틱의 상단 오프셋과 노브의 수평 중심 오프셋을 토큰에서 계산한다(매직넘버 -1/-5 제거).
const BAR_TOP_OFFSET = (gauge.knobSize - gauge.barHeight) / 2;
const KNOB_LEFT_OFFSET = -gauge.knobSize / 2;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.xs,
  },
  gaugeArea: {
    position: 'relative',
    // 고정 픽셀 높이 — 글꼴 배율과 무관하게 틱/노브 절대 위치 기준이 결정적이다(DAR-174).
    height: gauge.knobSize,
    justifyContent: 'center',
  },
  bar: {
    height: gauge.barHeight,
    borderRadius: gauge.barRadius,
  },
  tick: {
    position: 'absolute',
    // 막대가 게이지 영역 세로 중앙에 놓이므로 틱도 동일 오프셋으로 막대에 정렬.
    top: BAR_TOP_OFFSET,
    width: gauge.tickWidth,
    height: gauge.barHeight,
  },
  knob: {
    position: 'absolute',
    width: gauge.knobSize,
    height: gauge.knobSize,
    borderRadius: gauge.knobSize / 2,
    top: 0, // gaugeArea 높이 = knobSize → 노브가 영역에 꽉 차며 막대 중앙에 정렬
    marginLeft: KNOB_LEFT_OFFSET, // 노브 중심을 현재값에 정렬
  },
  captionRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: spacing.xs,
  },
});
