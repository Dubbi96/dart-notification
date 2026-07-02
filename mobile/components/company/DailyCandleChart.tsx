import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  type LayoutChangeEvent,
} from 'react-native';
import Svg, { Line, Rect, Circle } from 'react-native-svg';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@theme';
import { spacing } from '@theme/spacing';
import { returnColor } from '@utils/numberFormat';
import { useCandleScrub } from '@hooks/useCandleScrub';

import type { CandleSeriesPoint } from '@app-types/market-quote.types';

/**
 * 일봉(딥히스토리) 차트 — DAR-384.
 * 시·고·저·종 캔들(꼬리=고저, 몸통=시종) + 하단 거래량 보조 바. react-native-svg(기존 의존성)만.
 * 데이터는 KRX 일봉(StockDailyPrice 백필, source=EOD) — 장 마감 후 확정가다.
 * 상승(종≥시) success / 하락 error — 앱 전역 등락 색 규약(returnColor)과 일치.
 * 빈 데이터/로딩/에러를 graceful 하게 흡수(가짜 차트 금지). 색 단독 의미 금지 → 날짜·가격 평문 병기.
 * ★정직: 일봉은 거래일 장 마감 종가 기준임을 사용자 언어로 고지한다(DAR-458 E7).
 * ★인터랙션: 장기 구간(1Y/전체 ~250봉)에서도 좌우 스크럽(크로스헤어)으로 가는 캔들까지 선택(DAR-458 E6).
 * ★성능: 캔들·거래량 정적 레이어는 useMemo 로 고정 — 스크럽마다 전량 SVG 재생성 금지(UXR-9 S-성능/P-1).
 */

const PRICE_HEIGHT = 180;
const VOLUME_HEIGHT = 44;
const GAP = spacing.xs;
const PAD = { top: spacing.sm, right: spacing.sm, bottom: spacing.sm, left: spacing.sm };
/** 비활성 거래량 바 dim 불투명도 — 활성 강조는 원색 오버레이 1개로 위에 얹는다(UXR-9). */
const VOLUME_DIM_OPACITY = 0.55;

/** 거래량 바 높이(px, 최소 1) — 정적 레이어와 활성 오버레이가 동일 공식을 공유(UXR-9). */
function volumeBarH(volume: number, maxV: number): number {
  return Math.max(1, (volume / maxV) * (VOLUME_HEIGHT - 2));
}

/** ISO(UTC instant) → KST 거래일 컴포넌트. 일봉 time 은 거래일 자정 UTC(=09:00 KST 같은 날). */
function kstParts(iso: string): { y: number; m: number; d: number } | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const kst = new Date(t + 9 * 60 * 60 * 1000);
  return { y: kst.getUTCFullYear(), m: kst.getUTCMonth() + 1, d: kst.getUTCDate() };
}

/** ISO → 'YY.MM.DD' (요약). 파싱 불가면 원문. */
function fullDate(iso: string): string {
  const p = kstParts(iso);
  if (!p) return iso;
  const yy = String(p.y).slice(2);
  return `${yy}.${String(p.m).padStart(2, '0')}.${String(p.d).padStart(2, '0')}`;
}

/** ISO → 'MM/DD' (축 간결 표기). 파싱 불가면 원문. */
function shortDate(iso: string): string {
  const p = kstParts(iso);
  if (!p) return iso;
  return `${String(p.m).padStart(2, '0')}/${String(p.d).padStart(2, '0')}`;
}

function won(v: number): string {
  return `${Math.round(v).toLocaleString('ko-KR')}원`;
}

/** 서버 조회 ISO 시각 → 'YYYY.MM.DD' (환경시계 괴리 고지 보조). 파싱 불가면 빈 문자열. */
function asOfDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

interface DailyCandleChartProps {
  candles: CandleSeriesPoint[];
  /** 일봉 출처 — 'EOD'(KRX 일봉) | 'TIMESCALE' | 'UNAVAILABLE'. 정직 라벨에 반영. */
  source?: 'EOD' | 'TIMESCALE' | 'UNAVAILABLE';
  /** 서버 조회 시각(ISO). 있으면 정직 라벨에 '서버 조회 YYYY.MM.DD' 병기. */
  asOf?: string;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

export function DailyCandleChart({
  candles,
  source,
  asOf,
  isLoading = false,
  isError = false,
  onRetry,
}: DailyCandleChartProps) {
  const { colors, typography: typo } = useTheme();
  const [width, setWidth] = useState(0);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  const { minP, maxP, maxV } = useMemo(() => {
    if (candles.length === 0) return { minP: 0, maxP: 0, maxV: 0 };
    let lo = Infinity;
    let hi = -Infinity;
    let vMax = 0;
    for (const c of candles) {
      if (c.low < lo) lo = c.low;
      if (c.high > hi) hi = c.high;
      if (c.volume > vMax) vMax = c.volume;
    }
    if (lo === hi) {
      const pad = Math.abs(lo) * 0.01 || 1;
      lo -= pad;
      hi += pad;
    }
    return { minP: lo, maxP: hi, maxV: vMax };
  }, [candles]);

  // 지오메트리(글꼴 배율 독립) — 가로 스크럽 훅(useCandleScrub)을 조건부 return 이전에 호출하기 위해
  // n·slotW 를 먼저 계산한다(Rules of Hooks). 로딩/빈 데이터 경로에선 width=0 이라 0/NaN 이 나오지만
  // 어차피 렌더에 쓰이지 않는다.
  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const priceH = PRICE_HEIGHT - PAD.top - PAD.bottom;
  const n = candles.length;
  // 슬롯 폭 — 캔들 1개도 균등 배치. 몸통은 슬롯의 60%(최소 1px).
  const slotW = n > 0 ? plotW / n : plotW;
  const bodyW = Math.max(1, slotW * 0.6);
  // 정적 레이어 useMemo 의존성이므로 안정 참조(useCallback) 유지(UXR-9).
  const xCenter = useCallback((i: number) => PAD.left + slotW * (i + 0.5), [slotW]);
  const yPrice = useCallback(
    (v: number) => PAD.top + priceH - ((v - minP) / (maxP - minP || 1)) * priceH,
    [priceH, minP, maxP],
  );

  // 가로 스크럽(크로스헤어) 상호작용 — 일봉/분봉 공용 훅(DAR-472, E6).
  const { activeIndex, handleScrub, handleA11yAction } = useCandleScrub({
    count: n,
    slotW,
    padLeft: PAD.left,
  });

  // ★성능(UXR-9): 캔들·거래량 정적 레이어 — 스크럽(activeIndex)과 무관한 지오메트리이므로
  // useMemo(candles·width(slotW→xCenter 경유)·colors 키)로 고정한다. 스크럽 프레임마다
  // ~250봉 × 3노드의 SVG 재생성을 차단하고, 활성 강조는 오버레이 1벌이 담당(캔들별 isActive 분기 제거).
  const candleLayer = useMemo(
    () =>
      candles.map((c, i) => {
        const up = c.close >= c.open;
        const color = returnColor(c.close - c.open, colors);
        const cx = xCenter(i);
        const yHigh = yPrice(c.high);
        const yLow = yPrice(c.low);
        const yOpen = yPrice(c.open);
        const yClose = yPrice(c.close);
        const bodyTop = Math.min(yOpen, yClose);
        const bodyH = Math.max(1, Math.abs(yClose - yOpen));
        return (
          <React.Fragment key={`${c.time}-${i}`}>
            {/* 꼬리: 고가–저가 */}
            <Line x1={cx} y1={yHigh} x2={cx} y2={yLow} stroke={color} strokeWidth={1} />
            {/* 몸통: 시가–종가 (상승=채움, 보합/하락도 색 구분) */}
            <Rect
              x={cx - bodyW / 2}
              y={bodyTop}
              width={bodyW}
              height={bodyH}
              fill={up ? color : colors.surface}
              stroke={color}
              strokeWidth={1}
            />
          </React.Fragment>
        );
      }),
    [candles, colors, xCenter, yPrice, bodyW],
  );
  const volumeLayer = useMemo(
    () =>
      candles.map((c, i) => {
        const color = returnColor(c.close - c.open, colors);
        const h = volumeBarH(c.volume, maxV);
        return (
          <Rect
            key={`v-${c.time}-${i}`}
            x={xCenter(i) - bodyW / 2}
            y={VOLUME_HEIGHT - h}
            width={bodyW}
            height={h}
            fill={color}
            opacity={VOLUME_DIM_OPACITY}
          />
        );
      }),
    [candles, colors, maxV, xCenter, bodyW],
  );

  // --- 로딩 ---
  if (isLoading) {
    return (
      <View style={[styles.stateBox, { height: PRICE_HEIGHT + VOLUME_HEIGHT }]}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[typo.small, { color: colors.textSecondary, marginTop: spacing.sm }]}>
          일봉 불러오는 중…
        </Text>
      </View>
    );
  }

  // --- 에러 ---
  if (isError) {
    return (
      <View style={[styles.stateBox, { height: PRICE_HEIGHT + VOLUME_HEIGHT }]}>
        <Feather name="alert-circle" size={28} color={colors.error} />
        <Text style={[typo.caption, { color: colors.text, marginTop: spacing.sm }]}>
          일봉을 불러오지 못했어요
        </Text>
        {onRetry ? (
          <Pressable
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel="일봉 다시 불러오기"
            style={[styles.retryBtn, { borderColor: colors.borderLight }]}
          >
            <Feather name="refresh-cw" size={14} color={colors.textSecondary} />
            <Text style={[typo.small, { color: colors.textSecondary, marginLeft: spacing.xs }]}>
              재시도
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  // --- 빈 데이터 ---
  if (candles.length === 0) {
    return (
      <View style={[styles.stateBox, { height: PRICE_HEIGHT + VOLUME_HEIGHT }]}>
        <Feather name="bar-chart-2" size={28} color={colors.textTertiary} />
        <Text
          style={[typo.caption, { color: colors.textSecondary, marginTop: spacing.sm, textAlign: 'center' }]}
        >
          일봉 데이터가 아직 없어요{'\n'}이 종목의 KRX 일봉이 적재되면 표시됩니다
        </Text>
      </View>
    );
  }

  const active = candles[activeIndex];
  const first = candles[0];
  const last = candles[n - 1];
  // 요약 색 — 구간 첫 시가 대비 최신 종가 방향.
  const periodOpen = first.open;
  const summaryColor = returnColor(last.close - periodOpen, colors);
  const sourceLabel = source === 'EOD' ? 'KRX 일봉(장 마감 종가)' : '일봉';
  // 활성 캔들 강조 오버레이 지오메트리(UXR-9) — 정적 레이어와 동일 규칙(꼬리=고저, 몸통=시종).
  const activeColor = returnColor(active.close - active.open, colors);
  const activeUp = active.close >= active.open;
  const activeBodyTop = Math.min(yPrice(active.open), yPrice(active.close));
  const activeBodyH = Math.max(1, Math.abs(yPrice(active.close) - yPrice(active.open)));
  const activeVolH = maxV > 0 ? volumeBarH(active.volume, maxV) : 0;

  return (
    <View style={styles.wrap}>
      {/* ★정직 라벨(E7) — 사용자 언어, 거래일 장 마감 종가 기준 */}
      <View style={styles.honestyRow}>
        <Feather name="calendar" size={12} color={colors.textTertiary} />
        <Text style={[typo.small, { color: colors.textTertiary, marginLeft: spacing.xs, flex: 1 }]}>
          {sourceLabel} · 거래일 종가 기준
          {asOfDate(asOf ?? '') ? ` (서버 조회 ${asOfDate(asOf ?? '')})` : ''}
        </Text>
      </View>

      {/* 선택(또는 최신) 캔들 요약 — 색 단독 금지, 날짜·OHLC 평문 병기 */}
      <View
        style={styles.summary}
        accessibilityRole="text"
        accessibilityLabel={`${fullDate(active.time)} 시가 ${won(active.open)}, 고가 ${won(
          active.high,
        )}, 저가 ${won(active.low)}, 종가 ${won(active.close)}, 거래량 ${active.volume.toLocaleString(
          'ko-KR',
        )}주`}
      >
        <Text style={[typo.captionMedium, { color: colors.text }]}>{fullDate(active.time)}</Text>
        <Text style={[typo.small, { color: summaryColor }]}>종가 {won(active.close)}</Text>
        <Text style={[typo.small, { color: colors.textTertiary }]}>
          거래량 {active.volume.toLocaleString('ko-KR')}
        </Text>
      </View>

      <View onLayout={onLayout}>
        {width > 0 ? (
          <View style={{ height: PRICE_HEIGHT }}>
            <Svg width={width} height={PRICE_HEIGHT}>
              {/* 정적 캔들 레이어(useMemo) — 스크럽 시 재생성되지 않는다(UXR-9) */}
              {candleLayer}
              {/* 활성 캔들 강조(UXR-9) — 캔들별 isActive 분기 대신 활성 캔들 1개만 위에 다시 그린다(꼬리 굵게+몸통) */}
              <Line
                x1={xCenter(activeIndex)}
                y1={yPrice(active.high)}
                x2={xCenter(activeIndex)}
                y2={yPrice(active.low)}
                stroke={activeColor}
                strokeWidth={2}
              />
              <Rect
                x={xCenter(activeIndex) - bodyW / 2}
                y={activeBodyTop}
                width={bodyW}
                height={activeBodyH}
                fill={activeUp ? activeColor : colors.surface}
                stroke={activeColor}
                strokeWidth={1}
              />
              {/* 크로스헤어(E6) — 스크럽 위치 세로 점선 + 종가 마커. 색 단독 의미 아님(요약 평문 병기). */}
              <Line
                x1={xCenter(activeIndex)}
                y1={PAD.top}
                x2={xCenter(activeIndex)}
                y2={PAD.top + priceH}
                stroke={colors.textTertiary}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <Circle cx={xCenter(activeIndex)} cy={yPrice(active.close)} r={3} fill={colors.text} />
            </Svg>
            {/* 가로 스크럽 오버레이(E6) — 전폭·전체 높이(≥44pt) 터치영역. 좌우로 문질러 캔들 선택. */}
            <View
              style={StyleSheet.absoluteFill}
              onStartShouldSetResponder={() => true}
              onResponderGrant={handleScrub}
              onResponderMove={handleScrub}
              accessibilityRole="adjustable"
              accessibilityLabel="가격 차트 — 좌우로 문질러 거래일 선택"
              accessibilityValue={{ text: `${fullDate(active.time)} 종가 ${won(active.close)}` }}
              accessibilityActions={[
                { name: 'increment', label: '다음 거래일' },
                { name: 'decrement', label: '이전 거래일' },
              ]}
              onAccessibilityAction={handleA11yAction}
            />
          </View>
        ) : (
          <View style={{ height: PRICE_HEIGHT }} />
        )}

        {/* 거래량 보조 차트 */}
        {width > 0 && maxV > 0 ? (
          <Svg width={width} height={VOLUME_HEIGHT} style={{ marginTop: GAP }}>
            {/* 정적 거래량 레이어(useMemo, dim) — 스크럽 시 재생성되지 않는다(UXR-9) */}
            {volumeLayer}
            {/* 활성 거래량 강조 — dim 바 위에 원색 바 1개(기존 opacity 1 강조와 동일하게 보임) */}
            <Rect
              x={xCenter(activeIndex) - bodyW / 2}
              y={VOLUME_HEIGHT - activeVolH}
              width={bodyW}
              height={activeVolH}
              fill={activeColor}
            />
          </Svg>
        ) : null}
      </View>

      {/* X축 양 끝 거래일 + 구간 요약 */}
      <View style={styles.axisRow}>
        <Text style={[typo.small, { color: colors.textTertiary }]}>{shortDate(first.time)}</Text>
        <Text style={[typo.small, { color: colors.textTertiary }]}>
          시가 {won(periodOpen)} → 종가 {won(last.close)}
        </Text>
        <Text style={[typo.small, { color: colors.textTertiary }]}>{shortDate(last.time)}</Text>
      </View>

      {n >= 2 ? (
        <Text
          accessibilityRole="text"
          accessibilityLabel="차트를 좌우로 문지르면 해당 거래일의 시·고·저·종과 거래량을 볼 수 있습니다."
          style={[typo.small, { color: colors.textTertiary, marginTop: spacing.xs }]}
        >
          차트를 좌우로 문지르면 해당 거래일의 가격·거래량을 볼 수 있어요. ({n}개 거래일)
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.xs,
  },
  honestyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  summary: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  axisRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.xs,
  },
  stateBox: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderRadius: 8,
  },
});
