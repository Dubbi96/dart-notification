import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, type LayoutChangeEvent } from 'react-native';
import Svg, { Polyline, Line, Circle } from 'react-native-svg';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import { pnlColor } from '@utils/signalDisplay';

import type { EquityCurvePoint } from '@app-types/simulation.types';

// 모의 자산곡선 차트 — DAR-60.
// PortfolioRiskSnapshot 일별 평가금액을 svg 폴리라인으로 시각화. 초기원금은 점선 기준선.
// 점 1개 이하면 추세선을 그리지 않고 점/안내만 표시(가짜 추세선 금지).
// react-native-svg(기존 의존성)만 사용, 신규 의존성 0. 테마 토큰만 사용.

const CHART_HEIGHT = 180;
const PADDING = { top: spacing.md, right: spacing.md, bottom: spacing.md, left: spacing.md };

/** YYYYMMDD → M/D (축·툴팁 간결 표기) */
function shortDate(yyyymmdd: string): string {
  if (yyyymmdd.length !== 8) return yyyymmdd;
  return `${Number(yyyymmdd.slice(4, 6))}/${Number(yyyymmdd.slice(6, 8))}`;
}

function formatReturnPct(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

interface EquityCurveChartProps {
  points: EquityCurvePoint[];
  initialCapital: number;
}

export function EquityCurveChart({ points, initialCapital }: EquityCurveChartProps) {
  const { colors, typography: typo } = useTheme();
  const [width, setWidth] = useState(0);
  // 선택된 점(툴팁). 기본은 마지막 점(최신).
  const [selected, setSelected] = useState<number | null>(null);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const plotW = Math.max(0, width - PADDING.left - PADDING.right);
  const plotH = CHART_HEIGHT - PADDING.top - PADDING.bottom;

  // 값 범위 — 초기원금 기준선이 항상 보이도록 포함. 평탄(단일값)이면 패딩으로 분리.
  const { minV, maxV } = useMemo(() => {
    const vals = points.map((p) => p.totalValue).concat([initialCapital]);
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    if (lo === hi) {
      const pad = Math.abs(lo) * 0.05 || 1;
      lo -= pad;
      hi += pad;
    }
    return { minV: lo, maxV: hi };
  }, [points, initialCapital]);

  const xFor = (i: number) =>
    PADDING.left + (points.length <= 1 ? plotW / 2 : (plotW * i) / (points.length - 1));
  const yFor = (v: number) =>
    PADDING.top + plotH - ((v - minV) / (maxV - minV)) * plotH;

  const polyline = useMemo(
    () => points.map((p, i) => `${xFor(i)},${yFor(p.totalValue)}`).join(' '),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [points, width, minV, maxV],
  );

  const baselineY = yFor(initialCapital);
  const last = points[points.length - 1];
  const activeIndex = selected ?? points.length - 1;
  const active = points[activeIndex];
  const lineColor = last ? pnlColor(last.returnPct, colors) : colors.primary;

  const singlePoint = points.length === 1;

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      {/* 툴팁 — 선택(또는 최신) 점의 날짜·평가금액·수익률을 평문 병기(색 단독 의미 금지) */}
      {active ? (
        <View
          style={styles.tooltip}
          accessibilityRole="text"
          accessibilityLabel={`${shortDate(active.snapshotDate)} 모의 평가금액 ${Math.round(
            active.totalValue,
          ).toLocaleString('ko-KR')}원, 초기원금 대비 ${formatReturnPct(active.returnPct)}`}
        >
          <Text style={[typo.small, { color: colors.textSecondary }]}>
            {shortDate(active.snapshotDate)}
          </Text>
          <Text style={[typo.captionMedium, { color: colors.text }]}>
            {Math.round(active.totalValue).toLocaleString('ko-KR')}원
          </Text>
          <Text style={[typo.small, { color: pnlColor(active.returnPct, colors) }]}>
            {formatReturnPct(active.returnPct)}
          </Text>
        </View>
      ) : null}

      {width > 0 ? (
        <Svg width={width} height={CHART_HEIGHT}>
          {/* 초기원금 기준선(점선) */}
          <Line
            x1={PADDING.left}
            y1={baselineY}
            x2={width - PADDING.right}
            y2={baselineY}
            stroke={colors.textTertiary}
            strokeWidth={1}
            strokeDasharray="4 4"
          />
          {/* 추세선 — 점 2개 이상일 때만(가짜 추세선 금지) */}
          {points.length >= 2 ? (
            <Polyline
              points={polyline}
              fill="none"
              stroke={lineColor}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null}
          {/* 각 점 — 탭하면 툴팁 갱신 */}
          {points.map((p, i) => (
            <Circle
              key={p.snapshotDate}
              cx={xFor(i)}
              cy={yFor(p.totalValue)}
              r={i === activeIndex ? 5 : singlePoint ? 5 : 3}
              fill={i === activeIndex ? lineColor : colors.surface}
              stroke={lineColor}
              strokeWidth={1.5}
              onPress={() => setSelected(i)}
            />
          ))}
        </Svg>
      ) : (
        <View style={{ height: CHART_HEIGHT }} />
      )}

      {/* X축 양 끝 날짜 라벨 */}
      {points.length >= 2 ? (
        <View style={styles.axisRow}>
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            {shortDate(points[0].snapshotDate)}
          </Text>
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            {shortDate(points[points.length - 1].snapshotDate)}
          </Text>
        </View>
      ) : null}

      {/* 초기원금 범례 + 데이터 적을 때 정직 안내 */}
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.dashSwatch, { borderColor: colors.textTertiary }]} />
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            초기원금 {initialCapital.toLocaleString('ko-KR')}원
          </Text>
        </View>
        {singlePoint ? (
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            스냅샷 1개 — 점으로만 표시
          </Text>
        ) : null}
      </View>

      {/* 탭 안내(점 여러 개일 때) — 접근성: 탭 가능한 점이 있음을 명시 */}
      {points.length >= 2 ? (
        <Pressable
          accessibilityRole="text"
          accessibilityLabel="자산곡선의 점을 탭하면 해당 날짜의 평가금액을 볼 수 있습니다."
          style={styles.hint}
        >
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            점을 탭하면 날짜별 평가금액을 볼 수 있어요.
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.xs,
  },
  tooltip: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  axisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  legendRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  dashSwatch: {
    width: 16,
    height: 0,
    borderTopWidth: 1,
    borderStyle: 'dashed',
  },
  hint: {
    marginTop: spacing.xs,
  },
});
