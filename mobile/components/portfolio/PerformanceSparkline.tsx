import React, { useMemo, useState } from 'react';
import { View, StyleSheet, type LayoutChangeEvent } from 'react-native';
import Svg, { Polyline, Line } from 'react-native-svg';
import { useTheme } from '@theme';
import { pnlColor } from '@utils/signalDisplay';

// 성과 요약 1행용 스파크라인 — DAR-120.
// 자산곡선 누적수익률(%) 시계열을 축·툴팁 없는 미니 추세선으로 압축 표시한다.
// 점 2개 미만이면 추세선을 그리지 않는다(가짜 추세선 금지) — 호출부에서 빈 상태 처리.
// react-native-svg(기존 의존성)만 사용·테마 토큰만(하드코딩 색상 0).

const HEIGHT = 36;
const STROKE = 2;

interface PerformanceSparklineProps {
  /** 누적 수익률(%) 시계열(오름차순). 마지막 값 부호로 색을 정한다. */
  values: number[];
}

export function PerformanceSparkline({ values }: PerformanceSparklineProps) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  // 기준선(0%) 포함 범위 — 손익 0 라인이 항상 보이도록.
  const { min, max } = useMemo(() => {
    const vals = values.concat([0]);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    return { min: lo, max: hi };
  }, [values]);

  const plotH = HEIGHT - STROKE;
  const last = values.length > 0 ? values[values.length - 1] : 0;
  const lineColor = pnlColor(last, colors);

  const points =
    width > 0 && values.length >= 2
      ? values
          .map((v, i) => {
            const x = (width * i) / (values.length - 1);
            const y = STROKE / 2 + plotH - ((v - min) / (max - min)) * plotH;
            return `${x.toFixed(1)},${y.toFixed(1)}`;
          })
          .join(' ')
      : '';

  // 0% 기준선 y 좌표
  const zeroY = STROKE / 2 + plotH - ((0 - min) / (max - min)) * plotH;

  return (
    <View style={styles.container} onLayout={onLayout}>
      {width > 0 && values.length >= 2 ? (
        <Svg width={width} height={HEIGHT}>
          <Line
            x1={0}
            y1={zeroY}
            x2={width}
            y2={zeroY}
            stroke={colors.borderLight}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          <Polyline
            points={points}
            fill="none"
            stroke={lineColor}
            strokeWidth={STROKE}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: HEIGHT,
    flex: 1,
    justifyContent: 'center',
  },
});
