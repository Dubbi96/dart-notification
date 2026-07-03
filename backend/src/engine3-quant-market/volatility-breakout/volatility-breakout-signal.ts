// Engine3 — 변동성 돌파 위성 진입 신호 · 변동성 조절 사이징 (순수 Rule, DAR-491 [견고화 W1·P14])
//
// AI 금지영역 불가침: 목표가·사이징은 일봉 데이터 기반 순수 수식. AI/LLM 개입 0.
// 이 모듈은 "신호·사이징 정의"만 소유한다(engine3 = 시세·지표 도메인). forward 트랙 배선·
// 장중 돌파 감지·익일 시가 청산·DB 영속은 engine5 가 P15 에서 독립 강제한다.
// 순수 함수라 fixture 로 결정론적 검증 가능(intraday-scalp-signal 신호/체결 분리 패턴 준용).
//
// 전략(래리 윌리엄스 변동성 돌파, 위성 자본 25%):
//   목표가 = 당일 시가 O + 전일 Range(H−L) × K(0.5, frozen) — 호가단위 정렬
//   진입   = 장중 현재가 ≥ 목표가 (1일 1회, 재진입 없음; 스캔·dedup 은 P15)
//   청산   = 익일 시가 전량 (P15)
//   사이징 = 위성 배분금액 × min(1, 목표변동성 / 전일 Range%) → 정수 수량(floor)
//   추세필터(옵션, 기본 OFF) = 전일 종가 > SMA(종가, 5)
//
// ★호가단위 정렬: engine5 fill-simulator 의 `krxTickSize`(KRX 호가단위 사다리 SSOT)를 재사용한다
//   (중복 정의 금지 — 이슈 지정). krxTickSize 는 부수효과 없는 순수 함수이므로 도메인 간 서비스
//   호출이 아니다(측정 트랙 무접촉: engine5 파일은 읽기만·무변경). 목표가는 '반올림'(nearest)으로
//   정렬한다 — 시장에 존재할 수 없는 비호가 가격을 방지(체결 슬리피지 정렬과 목적이 다름).

import { krxTickSize } from '../../engine5-trading-risk/domain/fill-simulator';
import {
  VOL_BREAKOUT_K,
  TARGET_DAILY_VOL_PCT,
  TREND_FILTER_ENABLED_DEFAULT,
  TREND_SMA_PERIOD,
} from './volatility-breakout.constants';

/** 일봉 1개(OHLC). 가격은 원(KRW). EtfDailyPrice(open/high/low/closePrice) 매핑. */
export interface OhlcBar {
  open: number;
  high: number;
  low: number;
  close: number;
}

/** 진입 판정 파라미터(상수화). 기본값은 룰북 §9.1 frozen 상수. */
export interface BreakoutEntryParams {
  /** 돌파 계수 K. 기본 0.5(frozen). */
  k: number;
  /** 목표 일간 변동성(%). 기본 1.0. */
  targetDailyVolPct: number;
  /** 추세 필터 활성 여부. 기본 false(OFF). */
  trendFilterEnabled: boolean;
  /** 추세 필터 SMA 기간(일). 기본 5. */
  trendSmaPeriod: number;
}

export const DEFAULT_BREAKOUT_ENTRY_PARAMS: BreakoutEntryParams = {
  k: VOL_BREAKOUT_K,
  targetDailyVolPct: TARGET_DAILY_VOL_PCT,
  trendFilterEnabled: TREND_FILTER_ENABLED_DEFAULT,
  trendSmaPeriod: TREND_SMA_PERIOD,
};

/** 진입 사유 태그(영속·표면화 SSOT). */
export const BREAKOUT_ENTRY_TAG = 'VOL_BREAKOUT';

/** 유한 양수 검사(가격·수량 가드). */
function isPositiveFinite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/** OHLC 바 유효성 — 모든 값 유한 양수 & high ≥ low. */
function isValidBar(bar: OhlcBar | null | undefined): bar is OhlcBar {
  return (
    !!bar &&
    isPositiveFinite(bar.open) &&
    isPositiveFinite(bar.high) &&
    isPositiveFinite(bar.low) &&
    isPositiveFinite(bar.close) &&
    bar.high >= bar.low
  );
}

/**
 * 호가단위 '반올림'(nearest) 정렬 — engine5 krxTickSize(호가 사다리 SSOT) 재사용.
 * 목표가가 시장에 존재할 수 없는 임의 실수가 되지 않도록 최근접 유효 호가로 맞춘다.
 * (fill-simulator.roundToTick 은 슬리피지용 '불리한 방향' 정렬이라 목적이 다르다 — 여기선 반올림.)
 */
export function alignToTick(price: number): number {
  const tick = krxTickSize(price);
  return Math.round(price / tick) * tick;
}

/**
 * 목표가 = 당일 시가 O + 전일 Range(H−L) × K, 호가단위 정렬.
 *
 * @param prevBar  전일 일봉(OHLC). 결측/무효 시 null(진입 스킵 — fail-safe).
 * @param todayOpen 당일 시가(원). 무효(≤0/비유한) 시 null.
 * @param k        돌파 계수. 기본 0.5(frozen).
 * @returns 호가 정렬된 목표가(원), 또는 null(스킵).
 *
 * 경계: 전일 Range ≤ 0(H=L, 거래정지 등 degenerate)이면 돌파 기준이 성립하지 않아 null(스킵).
 */
export function computeBreakoutTarget(
  prevBar: OhlcBar | null | undefined,
  todayOpen: number,
  k: number = VOL_BREAKOUT_K,
): number | null {
  if (!isValidBar(prevBar)) return null;
  if (!isPositiveFinite(todayOpen)) return null;
  if (!Number.isFinite(k)) return null;

  const range = prevBar.high - prevBar.low;
  if (range <= 0) return null; // degenerate(무변동/거래정지) — 돌파 기준 없음

  const raw = todayOpen + range * k;
  return alignToTick(raw);
}

/**
 * 전일 Range% = (H−L) / 전일 종가 × 100. 변동성 조절 사이징의 분모.
 * @returns Range%(양수), 또는 null(무효/degenerate).
 */
export function computeRangePct(prevBar: OhlcBar | null | undefined): number | null {
  if (!isValidBar(prevBar)) return null;
  const range = prevBar.high - prevBar.low;
  if (range <= 0) return null;
  return (range / prevBar.close) * 100;
}

/**
 * 변동성 조절 사이징계수 = min(1, 목표변동성% / 전일 Range%).
 * 전일 변동성이 목표(1%)보다 크면 축소(<1), 작으면 상한 1로 캡(레버리지 금지).
 * @returns 사이징계수(0<factor≤1), 또는 null(전일 데이터 무효 → 진입 스킵).
 */
export function computeVolSizingFactor(
  prevBar: OhlcBar | null | undefined,
  targetDailyVolPct: number = TARGET_DAILY_VOL_PCT,
): number | null {
  const rangePct = computeRangePct(prevBar);
  if (rangePct === null) return null;
  if (!isPositiveFinite(targetDailyVolPct)) return null;
  return Math.min(1, targetDailyVolPct / rangePct);
}

/**
 * 변동성 조절 수량 산출 = floor(위성 배분금액 × 사이징계수 / 참조가).
 *
 * @param prevBar          전일 일봉(사이징계수 산출). 무효 시 null(진입 스킵).
 * @param targetDailyVolPct 목표 일간 변동성(%). 기본 1.0.
 * @param allocationKrw     위성 배분금액(원). 이 트랙에 배정된 자본(2단 프레임 배선은 P16).
 * @param referencePrice    수량 환산 기준가(원). 기본 = 전일 종가(a-priori 참조가);
 *                          P15 는 호가 정렬된 목표가(computeBreakoutTarget 결과)를 넘겨 배분금액 상한을 정확히 지킨다.
 * @returns 정수 매수 수량(≥0), 또는 null(전일 데이터 무효/입력 무효 → 진입 스킵).
 *
 * ※ 정수 수량은 '배분금액 ÷ 체결가'로만 산출 가능하므로 참조가가 필요하다(이슈 시그니처의
 *   3인자 축약을 배분금액 상한 정확화를 위해 4번째 참조가로 확장 — 미지정 시 전일 종가로 폴백).
 */
export function computeVolAdjustedSizing(
  prevBar: OhlcBar | null | undefined,
  targetDailyVolPct: number,
  allocationKrw: number,
  referencePrice?: number,
): number | null {
  const factor = computeVolSizingFactor(prevBar, targetDailyVolPct);
  if (factor === null) return null;
  if (!isPositiveFinite(allocationKrw)) return null;

  // 참조가: 명시값 우선, 없으면 전일 종가(isValidBar 이미 통과 → prevBar 유효 보장).
  const price = referencePrice ?? (prevBar as OhlcBar).close;
  if (!isPositiveFinite(price)) return null;

  const budget = allocationKrw * factor;
  return Math.floor(budget / price);
}

/** 단순이동평균(SMA). 빈 배열이면 null. */
export function computeSma(closes: readonly number[]): number | null {
  if (closes.length === 0) return null;
  let s = 0;
  for (const c of closes) s += c;
  return s / closes.length;
}

/**
 * 추세 필터: 전일 종가 > SMA(종가, period).
 *
 * @param recentCloses 최근 종가(오름차순, **마지막 원소 = 전일 종가**). period 개 이상 필요.
 * @param period       SMA 기간. 기본 5.
 * @returns 전일 종가가 최근 period 일 SMA 를 상회하면 true. 표본 부족 시 false(fail-safe 미진입).
 */
export function passesTrendFilter(
  recentCloses: readonly number[],
  period: number = TREND_SMA_PERIOD,
): boolean {
  if (period <= 0) return false;
  if (recentCloses.length < period) return false;
  const window = recentCloses.slice(-period);
  const sma = computeSma(window);
  if (sma === null) return false;
  const prevClose = window[window.length - 1];
  return prevClose > sma;
}

/** 진입 판정 결과(신호 산출 surface — P15 forward 배선이 소비). */
export interface BreakoutEntryDecision {
  /** 진입 조건 충족 여부(목표가 도달 ∧ 추세필터 통과). */
  triggered: boolean;
  /** 호가 정렬 목표가(원). 전일 데이터 무효 시 null. */
  targetPrice: number | null;
  /** 평가 시점 장중 현재가(원). */
  currentPrice: number;
  /** 현재가 ≥ 목표가 도달 여부. */
  reachedTarget: boolean;
  /** 추세 필터 통과 여부(필터 OFF 면 항상 true). */
  trendOk: boolean;
  /** 변동성 조절 사이징계수(0<factor≤1). 무효 시 null. */
  sizingFactor: number | null;
  /** 전일 데이터 결측/무효(degenerate) — graceful 미진입. */
  insufficientData: boolean;
  /** 사람이 읽는 요약(진입/미진입 사유). */
  detail: string;
}

/**
 * 변동성 돌파 진입 신호 판정(순수 함수) — 목표가 산출 + 도달 + (옵션)추세필터를 조립한다.
 * 장중 스캔·종목당 1회 dedup·재진입 금지·체결·청산은 engine5(P15)가 강제한다.
 *
 * @param prevBar      전일 일봉(OHLC). 결측/무효 시 insufficientData=true 미진입.
 * @param todayOpen    당일 시가(원).
 * @param currentPrice 평가 시점 장중 현재가(원).
 * @param recentCloses 추세 필터용 최근 종가(마지막 = 전일 종가). 필터 OFF 면 무시.
 * @param params       진입 파라미터(미지정 시 DEFAULT_BREAKOUT_ENTRY_PARAMS).
 */
export function evaluateBreakoutEntry(
  prevBar: OhlcBar | null | undefined,
  todayOpen: number,
  currentPrice: number,
  recentCloses: readonly number[] = [],
  params: BreakoutEntryParams = DEFAULT_BREAKOUT_ENTRY_PARAMS,
): BreakoutEntryDecision {
  const targetPrice = computeBreakoutTarget(prevBar, todayOpen, params.k);
  const sizingFactor = computeVolSizingFactor(prevBar, params.targetDailyVolPct);

  if (targetPrice === null) {
    return {
      triggered: false,
      targetPrice: null,
      currentPrice,
      reachedTarget: false,
      trendOk: false,
      sizingFactor,
      insufficientData: true,
      detail: '전일 일봉 결측/무효(Range≤0 등) — 미진입',
    };
  }

  const reachedTarget = isPositiveFinite(currentPrice) && currentPrice >= targetPrice;
  const trendOk = params.trendFilterEnabled
    ? passesTrendFilter(recentCloses, params.trendSmaPeriod)
    : true;
  const triggered = reachedTarget && trendOk;

  const detail = triggered
    ? `${BREAKOUT_ENTRY_TAG} 진입: 현재가 ${currentPrice} ≥ 목표가 ${targetPrice}` +
      (params.trendFilterEnabled ? `·추세필터 통과` : '') +
      `·사이징계수 ${sizingFactor?.toFixed(2)}`
    : `미진입(목표가도달=${reachedTarget}·추세필터=${trendOk})`;

  return {
    triggered,
    targetPrice,
    currentPrice,
    reachedTarget,
    trendOk,
    sizingFactor,
    insufficientData: false,
    detail,
  };
}
