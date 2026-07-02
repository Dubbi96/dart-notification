import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, type LayoutChangeEvent } from 'react-native';
import Svg, { Polyline, Line, Circle } from 'react-native-svg';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing, sizing } from '@theme/spacing';
import { pnlColor, sparklineTrendColor, sparklineTrendLabel } from '@utils/signalDisplay';
import { formatReturnPct } from '@utils/numberFormat';
import { useCandleScrub } from '@hooks/useCandleScrub';

import type { EquityCurvePoint } from '@app-types/simulation.types';

// 모의 자산곡선 차트 — DAR-60.
// PortfolioRiskSnapshot 일별 평가금액을 svg 폴리라인으로 시각화. 초기원금은 점선 기준선.
// 점 1개 이하면 추세선을 그리지 않고 점/안내만 표시(가짜 추세선 금지).
// react-native-svg(기존 의존성)만 사용, 신규 의존성 0. 테마 토큰만 사용.
// ★인터랙션(UXR-15 C-5): 점이 SCRUB_POINT_THRESHOLD 초과면(1년 백테스트 ~250점) 점별 44pt
//   히트영역이 전면 겹쳐 원하는 점 선택 불능 + Pressable·스크린리더 버튼 n개 폭증 →
//   차트 전체 1개 스크럽 오버레이(useCandleScrub, 캔들차트 E6 패턴)로 최근접 점을 선택하고,
//   시각 점도 폴리라인+크로스헤어로 대체한다(점 다운샘플링의 극한 — 점끼리 뭉개지는 밀도라 정보손실 0).
// ★성능(UXR-15 P-7): 폴리라인·점 정적 레이어는 useMemo 로 고정 — 선택(activeIndex)마다
//   SVG 전량 재생성 금지. 활성 강조는 오버레이 Circle 1개가 담당.

const CHART_HEIGHT = 180;
const PADDING = { top: spacing.md, right: spacing.md, bottom: spacing.md, left: spacing.md };
// 데이터점 투명 히트영역 한 변(≥44pt) — 작은 SVG 점(r=3~5px)을 탭·스크린리더로 선택 가능하게(C4).
const HIT = sizing.minTouchTarget;
// 점별 탭(44pt 히트영역) 모드의 최대 점 개수(UXR-15 C-5). 초과하면 점 간격이 손끝(44pt)보다
// 훨씬 촘촘해 히트영역이 수십 겹으로 겹치므로(마지막 렌더 점만 선택됨), 점별 Pressable 대신
// 차트 전체 단일 스크럽 제스처로 전환한다.
const SCRUB_POINT_THRESHOLD = 30;

/** 스크럽 오버레이 responder 채택 — 항상 true(차트 전폭 단일 제스처 영역). */
const alwaysSetResponder = () => true;

/** 스크럽 오버레이 스크린리더 증감 액션(adjustable) — 점 1칸씩 이동. */
const SCRUB_A11Y_ACTIONS = [
  { name: 'increment', label: '다음 날짜' },
  { name: 'decrement', label: '이전 날짜' },
];

/** YYYYMMDD → M/D (축·툴팁 간결 표기) */
function shortDate(yyyymmdd: string): string {
  if (yyyymmdd.length !== 8) return yyyymmdd;
  return `${Number(yyyymmdd.slice(4, 6))}/${Number(yyyymmdd.slice(6, 8))}`;
}

/**
 * 점 라벨 — DAR-393. live(현재 실시간 실가 재평가) 점은 날짜 대신 '현재(실시간)'로 표기해
 * 과거 스냅샷(정체 가능)과 시각적으로 구분한다(헤더 평가금액과 같은 시점임을 명시).
 */
function pointLabel(p: EquityCurvePoint): string {
  return p.kind === 'live' ? '현재(실시간)' : shortDate(p.snapshotDate);
}

interface EquityCurveChartProps {
  points: EquityCurvePoint[];
  initialCapital: number;
}

export function EquityCurveChart({ points, initialCapital }: EquityCurveChartProps) {
  const { colors, typography: typo } = useTheme();
  const [width, setWidth] = useState(0);
  // 선택된 점(툴팁) — 점별 탭 모드(≤SCRUB_POINT_THRESHOLD)에서 사용. 기본은 마지막 점(최신).
  const [selected, setSelected] = useState<number | null>(null);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const plotW = Math.max(0, width - PADDING.left - PADDING.right);
  const plotH = CHART_HEIGHT - PADDING.top - PADDING.bottom;
  const n = points.length;
  // 스크럽 모드(C-5/P-7) — 점이 많으면 점별 44pt 히트영역이 전면 겹쳐 조작 불능이고
  // Pressable n개(네이티브 뷰)·SVG Circle n개가 마운트되므로 단일 제스처 오버레이로 전환.
  const scrubMode = n > SCRUB_POINT_THRESHOLD;

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

  // 점 간격(px) — 양끝 고정 균등 배치(x = left + step·i). n<=1 이면 가운데 1점(간격 미사용).
  const step = n > 1 ? plotW / (n - 1) : plotW;
  // 정적 레이어 useMemo 의존성이므로 안정 참조(useCallback) 유지(P-7).
  const xFor = useCallback(
    (i: number) => PADDING.left + (n <= 1 ? plotW / 2 : step * i),
    [n, plotW, step],
  );
  const yFor = useCallback(
    (v: number) => PADDING.top + plotH - ((v - minV) / (maxV - minV)) * plotH,
    [plotH, minV, maxV],
  );

  // 가로 스크럽 — 캔들차트 공용 훅(useCandleScrub) 재사용(C-5). 훅은 슬롯 중심(x=pad+slotW·(i+0.5))
  // 기하를 가정하므로, 양끝 고정(x=pad+step·i) 배치엔 padLeft 를 step/2 만큼 당겨 보정한다
  // (indexFromX 가 round((x−PADDING.left)/step) 과 동치 → 손가락 X의 최근접 점 선택).
  const scrub = useCandleScrub({ count: n, slotW: step, padLeft: PADDING.left - step / 2 });

  const baselineY = yFor(initialCapital);
  const activeIndex = scrubMode ? scrub.activeIndex : (selected ?? n - 1);
  const active = points[activeIndex];
  // 추세 색 = 곡선 기울기(첫→마지막 평가금액) 부호로 산정(C7). 마지막 점 부호(pnlColor)로 칠하면
  // '하락 중이나 양(+)인 곡선'이 초록이 되어 색=의미가 어긋난다. sparklineTrendColor 로 라인 기울기와
  // 색을 일치시키고, 색맹 대비로 추세 라벨(상승/하락/횡보)을 동반한다.
  const trendValues = useMemo(() => points.map((p) => p.totalValue), [points]);
  const lineColor = sparklineTrendColor(trendValues, colors);
  const trendLabel = sparklineTrendLabel(trendValues);

  const singlePoint = points.length === 1;

  // ★성능(P-7): 정적 레이어 useMemo — 선택(activeIndex)과 무관한 지오메트리이므로 고정.
  const polyline = useMemo(
    () => points.map((p, i) => `${xFor(i)},${yFor(p.totalValue)}`).join(' '),
    [points, xFor, yFor],
  );
  // 시각 점 정적 레이어 — 활성 강조는 오버레이 Circle 1개가 담당(점별 isActive 분기 제거).
  // 스크럽 모드에선 점 간격 ~1px 라 점끼리 뭉개져(시각 노이즈) 렌더하지 않는다 — 폴리라인이 대체.
  const dotLayer = useMemo(() => {
    if (scrubMode) return null;
    return points.map((p, i) => (
      <Circle
        key={p.snapshotDate}
        cx={xFor(i)}
        cy={yFor(p.totalValue)}
        r={singlePoint ? 5 : 3}
        fill={colors.surface}
        stroke={lineColor}
        strokeWidth={1.5}
      />
    ));
  }, [scrubMode, points, xFor, yFor, singlePoint, colors.surface, lineColor]);

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      {/* 툴팁 — 선택(또는 최신) 점의 날짜·평가금액·수익률을 평문 병기(색 단독 의미 금지) */}
      {active ? (
        <View
          style={styles.tooltip}
          accessibilityRole="text"
          accessibilityLabel={`${pointLabel(active)} 모의 평가금액 ${Math.round(
            active.totalValue,
          ).toLocaleString('ko-KR')}원, 초기원금 대비 ${formatReturnPct(active.returnPct, { digits: 2 })}`}
        >
          <Text style={[typo.small, { color: colors.textSecondary }]}>
            {pointLabel(active)}
          </Text>
          <Text style={[typo.captionMedium, { color: colors.text }]}>
            {Math.round(active.totalValue).toLocaleString('ko-KR')}원
          </Text>
          <Text style={[typo.small, { color: pnlColor(active.returnPct, colors, { digits: 2 }) }]}>
            {formatReturnPct(active.returnPct, { digits: 2 })}
          </Text>
        </View>
      ) : null}

      {width > 0 ? (
        <View style={styles.plotArea}>
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
            {/* 각 점(시각 전용·정적 useMemo) — 조작은 아래 히트영역/스크럽 오버레이가 담당 */}
            {dotLayer}
            {/* 크로스헤어(스크럽 모드) — 선택 위치 세로 점선. 색 단독 의미 아님(툴팁 평문 병기) */}
            {scrubMode && active ? (
              <Line
                x1={xFor(activeIndex)}
                y1={PADDING.top}
                x2={xFor(activeIndex)}
                y2={PADDING.top + plotH}
                stroke={colors.textTertiary}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
            ) : null}
            {/* 활성 점 강조 오버레이 1개 — 정적 점 레이어와 분리(선택마다 전량 재생성 금지, P-7) */}
            {active ? (
              <Circle
                cx={xFor(activeIndex)}
                cy={yFor(active.totalValue)}
                r={5}
                fill={lineColor}
                stroke={lineColor}
                strokeWidth={1.5}
              />
            ) : null}
          </Svg>
          {scrubMode ? (
            /* 스크럽 오버레이(C-5) — 전폭·전체 높이(≥44pt) 단일 터치영역. 좌우로 문질러 최근접 점
               선택. 스크린리더는 버튼 n개 나열 대신 adjustable 1개(증감 액션)로 탐색. */
            <View
              style={StyleSheet.absoluteFill}
              onStartShouldSetResponder={alwaysSetResponder}
              onResponderGrant={scrub.handleScrub}
              onResponderMove={scrub.handleScrub}
              accessibilityRole="adjustable"
              accessibilityLabel="자산곡선 — 좌우로 문질러 날짜 선택"
              accessibilityValue={
                active
                  ? {
                      text: `${pointLabel(active)} 모의 평가금액 ${Math.round(
                        active.totalValue,
                      ).toLocaleString('ko-KR')}원, 초기원금 대비 ${formatReturnPct(active.returnPct, { digits: 2 })}`,
                    }
                  : undefined
              }
              accessibilityActions={SCRUB_A11Y_ACTIONS}
              onAccessibilityAction={scrub.handleA11yAction}
            />
          ) : (
            /* 투명 44pt 히트영역 — 각 점을 탭/스크린리더로 선택(C4). 점별 날짜·금액 라벨 동반 */
            points.map((p, i) => (
              <Pressable
                key={`hit-${p.snapshotDate}`}
                onPress={() => setSelected(i)}
                style={[styles.pointHit, { left: xFor(i) - HIT / 2, top: yFor(p.totalValue) - HIT / 2 }]}
                accessibilityRole="button"
                accessibilityState={{ selected: i === activeIndex }}
                accessibilityLabel={`${pointLabel(p)} 모의 평가금액 ${Math.round(
                  p.totalValue,
                ).toLocaleString('ko-KR')}원, 초기원금 대비 ${formatReturnPct(p.returnPct, { digits: 2 })}`}
              />
            ))
          )}
        </View>
      ) : (
        <View style={{ height: CHART_HEIGHT }} />
      )}

      {/* X축 양 끝 날짜 라벨 */}
      {points.length >= 2 ? (
        <View style={styles.axisRow}>
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            {pointLabel(points[0])}
          </Text>
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            {pointLabel(points[points.length - 1])}
          </Text>
        </View>
      ) : null}

      {/* 초기원금 범례 + 추세 라벨(색맹 대비) + 데이터 적을 때 정직 안내 */}
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.dashSwatch, { borderColor: colors.textTertiary }]} />
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            초기원금 {initialCapital.toLocaleString('ko-KR')}원
          </Text>
        </View>
        {points.length >= 2 && trendLabel ? (
          <View
            style={styles.legendItem}
            accessibilityRole="text"
            accessibilityLabel={`자산곡선 추세 ${trendLabel}`}
          >
            <Feather
              name={
                trendLabel === '상승' ? 'trending-up' : trendLabel === '하락' ? 'trending-down' : 'minus'
              }
              size={14}
              color={lineColor}
            />
            <Text style={[typo.small, { color: lineColor }]}>추세 {trendLabel}</Text>
          </View>
        ) : null}
        {singlePoint ? (
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            스냅샷 1개 — 점으로만 표시
          </Text>
        ) : null}
      </View>

      {/* 조작 안내(점 여러 개일 때) — 접근성: 조작 방식(점 탭/좌우 스크럽)을 명시 */}
      {points.length >= 2 ? (
        <Pressable
          accessibilityRole="text"
          accessibilityLabel={
            scrubMode
              ? '자산곡선을 좌우로 문지르면 해당 날짜의 평가금액을 볼 수 있습니다.'
              : '자산곡선의 점을 탭하면 해당 날짜의 평가금액을 볼 수 있습니다.'
          }
          style={styles.hint}
        >
          <Text style={[typo.small, { color: colors.textTertiary }]}>
            {scrubMode
              ? `차트를 좌우로 문지르면 날짜별 평가금액을 볼 수 있어요. (${n}개 시점)`
              : '점을 탭하면 날짜별 평가금액을 볼 수 있어요.'}
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
  plotArea: {
    position: 'relative',
  },
  pointHit: {
    position: 'absolute',
    width: HIT,
    height: HIT,
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
