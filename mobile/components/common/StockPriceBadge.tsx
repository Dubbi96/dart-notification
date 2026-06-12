import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  type ViewStyle,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import { pnlColor } from '@utils/signalDisplay';

import type { StockQuote } from '@app-types/market-quote.types';

// 종목 가격 배지(DAR-158) — 현재가 + 전일대비%(색+부호) + 미니 스파크라인.
// 정직 계약: 색 단독 의미 금지(부호 병행). 데이터 없으면 null 반환(배지 미표시, 빈상태 흡수).
// 깜빡임/펄스 금지·테마 토큰만(하드코딩 색상 0)·react-native-svg(기존 의존성)만 사용.

const SPARK_WIDTH = 48;
const SPARK_HEIGHT = 18;
const SPARK_STROKE = 1.5;

interface StockPriceBadgeProps {
  /** 시세. null/undefined 면 배지를 그리지 않는다(가격 부재 흡수). */
  quote: StockQuote | null | undefined;
  /** 미니 스파크라인 표시 여부(기본 true). 점 2개 미만이면 자동 생략. */
  showSparkline?: boolean;
  style?: ViewStyle;
}

function MiniSparkline({ values, color }: { values: number[]; color: string }) {
  const [width, setWidth] = useState(SPARK_WIDTH);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const points = useMemo(() => {
    if (values.length < 2 || width <= 0) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1; // 평평하면 중앙 수평선
    const plotH = SPARK_HEIGHT - SPARK_STROKE;
    return values
      .map((v, i) => {
        const x = (width * i) / (values.length - 1);
        const y = SPARK_STROKE / 2 + plotH - ((v - min) / span) * plotH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  }, [values, width]);

  return (
    <View style={styles.spark} onLayout={onLayout}>
      {points ? (
        <Svg width={width} height={SPARK_HEIGHT}>
          <Polyline
            points={points}
            fill="none"
            stroke={color}
            strokeWidth={SPARK_STROKE}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </Svg>
      ) : null}
    </View>
  );
}

export function StockPriceBadge({ quote, showSparkline = true, style }: StockPriceBadgeProps) {
  const { colors, typography: typo } = useTheme();

  if (!quote || !(quote.price > 0)) return null;

  const pct = quote.changePercent;
  const changeColor = pct !== null ? pnlColor(pct, colors) : colors.textSecondary;
  const sign = pct !== null && pct > 0 ? '+' : '';
  const arrow = pct === null ? '' : pct > 0 ? '▲' : pct < 0 ? '▼' : '–';
  const priceText = `${quote.price.toLocaleString('ko-KR')}원`;
  const pctText = pct !== null ? `${arrow} ${sign}${pct.toFixed(2)}%` : '';
  const directionWord = pct === null ? '' : pct > 0 ? '상승' : pct < 0 ? '하락' : '보합';

  const canSpark = showSparkline && quote.sparkline.length >= 2;

  const a11y =
    `현재가 ${quote.price.toLocaleString('ko-KR')}원` +
    (pct !== null ? `, 전일대비 ${Math.abs(pct).toFixed(2)}퍼센트 ${directionWord}` : '');

  return (
    <View
      style={[styles.container, style]}
      accessible
      accessibilityLabel={a11y}
    >
      {canSpark && (
        <MiniSparkline values={quote.sparkline} color={changeColor} />
      )}
      <Text style={[typo.bodyMedium, { color: colors.text }]}>{priceText}</Text>
      {pctText ? (
        <Text style={[typo.small, styles.pctText, { color: changeColor }]}>{pctText}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  spark: {
    width: SPARK_WIDTH,
    height: SPARK_HEIGHT,
    justifyContent: 'center',
  },
  pctText: {
    fontWeight: '700',
  },
});
