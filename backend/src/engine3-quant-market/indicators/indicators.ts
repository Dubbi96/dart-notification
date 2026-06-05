/**
 * 순수 기술지표 계산 함수 모음 — 외부 의존성 없는 Pure Functions.
 * 데이터 부족 시 null 반환 (에러 없음).
 * AI 금지영역: 이 모듈의 계산 로직에 LLM/AI 개입 절대 금지.
 */

export interface Candle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface MACDResult {
  macdLine: number | null;
  signalLine: number | null;
  histogram: number | null;
}

export interface BollingerResult {
  upper: number | null;
  mid: number | null;
  lower: number | null;
}

export interface HighLow52W {
  high52w: number | null;
  low52w: number | null;
}

export interface AllIndicators {
  ma5: number | null;
  ma20: number | null;
  ma60: number | null;
  ma120: number | null;
  rsi14: number | null;
  macdLine: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  bollingerUpper: number | null;
  bollingerMid: number | null;
  bollingerLower: number | null;
  atr14: number | null;
  vwap: number | null;
  volumeRatio20: number | null;
  high52w: number | null;
  low52w: number | null;
  preDsclReturn: number | null;
}

/** 단순 이동평균 (SMA). closes 끝에서 period개. 데이터 부족 시 null. */
export function calcMA(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** 지수 이동평균 (EMA) 전체 시계열 반환. 초기 period-1개는 NaN. */
function emaArray(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result: number[] = new Array(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    if (i === period - 1) {
      result[i] = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    } else {
      result[i] = values[i] * k + result[i - 1] * (1 - k);
    }
  }
  return result;
}

/**
 * RSI (Wilder's 방식).
 * closes: 종가 배열 (오래된 순). period 기본값 14.
 * 최소 period+1개 필요.
 */
export function calcRSI(closes: number[], period = 14): number | null {
  if (closes.length <= period) return null;

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += Math.abs(diff);
  }
  avgGain /= period;
  avgLoss /= period;

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

/**
 * MACD (12,26,9 기본값).
 * 최소 slow + signal - 1개의 closes 필요.
 */
export function calcMACD(
  closes: number[],
  fast = 12,
  slow = 26,
  signal = 9,
): MACDResult {
  const needed = slow + signal - 1;
  if (closes.length < needed) {
    return { macdLine: null, signalLine: null, histogram: null };
  }

  const fastEMA = emaArray(closes, fast);
  const slowEMA = emaArray(closes, slow);

  const macdLine: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (!isNaN(fastEMA[i]) && !isNaN(slowEMA[i])) {
      macdLine.push(fastEMA[i] - slowEMA[i]);
    }
  }

  if (macdLine.length < signal) {
    return { macdLine: null, signalLine: null, histogram: null };
  }

  const signalEMA = emaArray(macdLine, signal);
  const lastIdx = macdLine.length - 1;
  const lastMacd = macdLine[lastIdx];
  const lastSignal = signalEMA[lastIdx];

  if (isNaN(lastSignal)) {
    return { macdLine: null, signalLine: null, histogram: null };
  }

  return {
    macdLine: lastMacd,
    signalLine: lastSignal,
    histogram: lastMacd - lastSignal,
  };
}

/**
 * 볼린저 밴드 (기본 20,2).
 * 최소 period개의 closes 필요.
 */
export function calcBollinger(
  closes: number[],
  period = 20,
  stdMult = 2,
): BollingerResult {
  if (closes.length < period) return { upper: null, mid: null, lower: null };
  const slice = closes.slice(-period);
  const mid = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, v) => sum + Math.pow(v - mid, 2), 0) / period;
  const std = Math.sqrt(variance);
  return {
    upper: mid + stdMult * std,
    mid,
    lower: mid - stdMult * std,
  };
}

/**
 * ATR (Average True Range, Wilder 방식).
 * candles: 오래된 순 캔들 배열. period 기본값 14.
 * 최소 period+1개 필요.
 */
export function calcATR(
  candles: Pick<Candle, 'high' | 'low' | 'close'>[],
  period = 14,
): number | null {
  if (candles.length <= period) return null;

  const tr: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const hl = candles[i].high - candles[i].low;
    const hpc = Math.abs(candles[i].high - candles[i - 1].close);
    const lpc = Math.abs(candles[i].low - candles[i - 1].close);
    tr.push(Math.max(hl, hpc, lpc));
  }

  if (tr.length < period) return null;

  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < tr.length; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
  }
  return atr;
}

/**
 * VWAP (전형가 기반). 세션(당일) 전체 캔들 사용.
 * 거래량 0이면 null.
 */
export function calcVWAP(
  candles: Pick<Candle, 'high' | 'low' | 'close' | 'volume'>[],
): number | null {
  if (candles.length === 0) return null;
  let totalPV = 0;
  let totalV = 0;
  for (const c of candles) {
    const tp = (c.high + c.low + c.close) / 3;
    totalPV += tp * c.volume;
    totalV += c.volume;
  }
  if (totalV === 0) return null;
  return totalPV / totalV;
}

/**
 * 거래량 비율 (현재 거래량 / period일 평균 거래량).
 * volumes 마지막 요소가 당일 거래량.
 * 최소 period+1개 필요.
 */
export function calcVolumeRatio(volumes: number[], period = 20): number | null {
  if (volumes.length < period + 1) return null;
  const current = volumes[volumes.length - 1];
  const past = volumes.slice(-period - 1, -1);
  const avg = past.reduce((a, b) => a + b, 0) / period;
  if (avg === 0) return null;
  return current / avg;
}

/**
 * 52주 최고/최저.
 * candles: 최대 252 거래일치 사용. 부족하면 전체 사용.
 */
export function calc52WHighLow(
  candles: Pick<Candle, 'high' | 'low'>[],
): HighLow52W {
  const lookback = Math.min(252, candles.length);
  if (lookback === 0) return { high52w: null, low52w: null };
  const slice = candles.slice(-lookback);
  return {
    high52w: Math.max(...slice.map((c) => c.high)),
    low52w: Math.min(...slice.map((c) => c.low)),
  };
}

/**
 * 공시 전 선행상승률 (D-5 ~ D-1).
 * closes: 오래된 순. disclosureIdx: 공시일(D-0) 인덱스.
 * D-5 종가 대비 D-1 종가 수익률(%).
 * disclosureIdx < 5이면 null.
 */
export function calcPreDisclosureReturn(
  closes: number[],
  disclosureIdx: number,
): number | null {
  if (disclosureIdx < 5) return null;
  const d5 = closes[disclosureIdx - 5];
  const d1 = closes[disclosureIdx - 1];
  if (!d5 || d5 <= 0) return null;
  return ((d1 - d5) / d5) * 100;
}

/**
 * 모든 지표 일괄 계산. candles: 오래된 순 정렬.
 * disclosureIdx: 공시일 인덱스 (preDsclReturn 계산 시). 없으면 null.
 */
export function calcAllIndicators(
  candles: Candle[],
  disclosureIdx: number | null = null,
): AllIndicators {
  const closes = candles.map((c) => c.close);
  const volumes = candles.map((c) => c.volume);
  const macd = calcMACD(closes);
  const bb = calcBollinger(closes);
  const hl52 = calc52WHighLow(candles);

  return {
    ma5: calcMA(closes, 5),
    ma20: calcMA(closes, 20),
    ma60: calcMA(closes, 60),
    ma120: calcMA(closes, 120),
    rsi14: calcRSI(closes),
    macdLine: macd.macdLine,
    macdSignal: macd.signalLine,
    macdHistogram: macd.histogram,
    bollingerUpper: bb.upper,
    bollingerMid: bb.mid,
    bollingerLower: bb.lower,
    atr14: calcATR(candles),
    vwap: calcVWAP(candles),
    volumeRatio20: calcVolumeRatio(volumes),
    high52w: hl52.high52w,
    low52w: hl52.low52w,
    preDsclReturn:
      disclosureIdx !== null
        ? calcPreDisclosureReturn(closes, disclosureIdx)
        : null,
  };
}
