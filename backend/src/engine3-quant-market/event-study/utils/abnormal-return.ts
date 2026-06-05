/**
 * abnormal-return.ts — 개별 이벤트 초과수익(AR) 계산 (M5-A, DAR-9)
 *
 * 키 명명 규칙:
 * - D0: "d0"
 * - D+N (N≥1): "d1", "d2", ..., "d20"
 * - D-N (N≥1): "dm1", "dm2", ..., "dm20"
 */

export interface PriceWindow {
  date: string;      // YYYYMMDD
  closePrice: number;
}

export interface ARResult {
  dailyReturns: Record<string, number>;    // 종목 일별 수익률 (%)
  marketReturns: Record<string, number>;   // 시장 일별 수익률 (%)
  dailyAR: Record<string, number>;         // 일별 초과수익 = stockReturn - marketReturn
  cumulativeAR: Record<string, number>;    // d1부터 누적 초과수익
  maxDrawdown: number;                     // D0~D+20 최대낙폭 (%)
  isUpD5: boolean;                         // cumulativeAR['d5'] > 0
  isCrashD5: boolean;                      // cumulativeAR['d5'] < -5
  volumeRatios: Record<string, number>;    // {"d1": ratio, "d3": avg}
}

/**
 * 단순 일별 수익률 계산
 * (to - from) / from * 100
 */
export function calcDailyReturn(from: number, to: number): number {
  if (from === 0) return 0;
  return ((to - from) / from) * 100;
}

/**
 * 키 이름 생성 helper
 */
function dayKey(relDay: number): string {
  if (relDay === 0) return 'd0';
  if (relDay > 0) return `d${relDay}`;
  return `dm${Math.abs(relDay)}`;
}

/**
 * D0 날짜를 기준으로 stockPrices 배열에서 D0 인덱스를 찾는다.
 */
function findD0Index(prices: PriceWindow[], d0Date: string): number {
  const idx = prices.findIndex(p => p.date === d0Date);
  return idx;
}

/**
 * 종목·시장의 일별 수익률을 키별로 계산한다.
 *
 * @param prices D-20~D+20 정렬된 가격 배열 (오름차순)
 * @param d0Idx prices 내 D0 인덱스
 * @param maxBefore 과거 최대 일수 (기본 20)
 * @param maxAfter 미래 최대 일수 (기본 20)
 */
function buildDailyReturns(
  prices: PriceWindow[],
  d0Idx: number,
  maxBefore = 20,
  maxAfter = 20,
): Record<string, number> {
  const returns: Record<string, number> = {};

  // d0: D-1 → D0 수익률
  if (d0Idx >= 1) {
    returns['d0'] = calcDailyReturn(prices[d0Idx - 1].closePrice, prices[d0Idx].closePrice);
  }

  // D+N (n≥1)
  for (let n = 1; n <= maxAfter; n++) {
    const fromIdx = d0Idx + n - 1;
    const toIdx = d0Idx + n;
    if (fromIdx < 0 || toIdx >= prices.length) break;
    returns[`d${n}`] = calcDailyReturn(prices[fromIdx].closePrice, prices[toIdx].closePrice);
  }

  // D-N (n≥1): D-(n) → D-(n-1) 수익률
  for (let n = 1; n <= maxBefore; n++) {
    const fromIdx = d0Idx - n;
    const toIdx = d0Idx - n + 1;
    if (fromIdx < 0 || toIdx < 0) break;
    returns[`dm${n}`] = calcDailyReturn(prices[fromIdx].closePrice, prices[toIdx].closePrice);
  }

  return returns;
}

/**
 * 거래량 비율 계산
 * D+1 거래량 / D-5 평균거래량, D+3 평균 / D-5 평균거래량
 */
function calcVolumeRatios(
  volumes: PriceWindow[],
  baselineVolumes: PriceWindow[],
  d0Date: string,
): Record<string, number> {
  const ratios: Record<string, number> = {};

  // baseline: D-5~D-1 평균 거래량
  const baseAvg =
    baselineVolumes.length > 0
      ? baselineVolumes.reduce((s, v) => s + v.closePrice, 0) / baselineVolumes.length
      : 0;

  if (baseAvg === 0) {
    return { d1: 1, d3: 1 };
  }

  // D0 인덱스
  const d0Idx = findD0Index(volumes, d0Date);
  if (d0Idx < 0) return { d1: 1, d3: 1 };

  // D+1
  const d1Idx = d0Idx + 1;
  if (d1Idx < volumes.length) {
    ratios['d1'] = volumes[d1Idx].closePrice / baseAvg;
  } else {
    ratios['d1'] = 1;
  }

  // D+3: D+1, D+2, D+3 평균
  const d3Volumes: number[] = [];
  for (let i = 1; i <= 3; i++) {
    const idx = d0Idx + i;
    if (idx < volumes.length) d3Volumes.push(volumes[idx].closePrice);
  }
  ratios['d3'] =
    d3Volumes.length > 0
      ? d3Volumes.reduce((s, v) => s + v, 0) / d3Volumes.length / baseAvg
      : 1;

  return ratios;
}

/**
 * D0~D+20 최대낙폭 (Max Drawdown) 계산
 * 고점 대비 저점 하락률 (%)
 */
function calcMaxDrawdown(prices: PriceWindow[], d0Idx: number, maxAfter = 20): number {
  let peak = prices[d0Idx]?.closePrice ?? 0;
  let maxDD = 0;

  for (let n = 0; n <= maxAfter; n++) {
    const idx = d0Idx + n;
    if (idx >= prices.length) break;
    const price = prices[idx].closePrice;
    if (price > peak) peak = price;
    if (peak > 0) {
      const dd = ((peak - price) / peak) * 100;
      if (dd > maxDD) maxDD = dd;
    }
  }

  return maxDD;
}

/**
 * 초과수익(AR) 계산 메인 함수
 *
 * @param stockPrices D-20~D+20 종목 가격 배열 (오름차순)
 * @param marketPrices 동일 기간 시장 지수 배열
 * @param d0Date D0 날짜 YYYYMMDD
 * @param volumes 거래량 배열 (선택)
 * @param baselineVolumes D-5~D-1 기준 거래량 배열 (선택)
 */
export function calcAR(
  stockPrices: PriceWindow[],
  marketPrices: PriceWindow[],
  d0Date: string,
  volumes?: PriceWindow[],
  baselineVolumes?: PriceWindow[],
): ARResult {
  const d0Idx = findD0Index(stockPrices, d0Date);

  // D0를 찾지 못한 경우: 가장 가까운 날짜 사용 (방어 로직)
  const effectiveD0Idx = d0Idx >= 0 ? d0Idx : Math.floor(stockPrices.length / 2);

  // 종목 일별 수익률
  const dailyReturns = buildDailyReturns(stockPrices, effectiveD0Idx);

  // 시장 인덱스용 인덱스 (날짜 기준 매핑)
  const marketD0Idx = findD0Index(marketPrices, d0Date);
  const effectiveMarketD0Idx =
    marketD0Idx >= 0 ? marketD0Idx : Math.floor(marketPrices.length / 2);
  const marketReturns = buildDailyReturns(marketPrices, effectiveMarketD0Idx);

  // 일별 AR = stockReturn - marketReturn
  const dailyAR: Record<string, number> = {};
  const allKeys = new Set([...Object.keys(dailyReturns), ...Object.keys(marketReturns)]);
  for (const key of allKeys) {
    dailyAR[key] = (dailyReturns[key] ?? 0) - (marketReturns[key] ?? 0);
  }

  // 누적 AR: d1부터 시작하여 d20까지 누적합
  const cumulativeAR: Record<string, number> = {};
  let cumSum = 0;
  for (let n = 1; n <= 20; n++) {
    const key = `d${n}`;
    cumSum += dailyAR[key] ?? 0;
    cumulativeAR[key] = cumSum;
  }

  // 최대낙폭
  const maxDrawdown = calcMaxDrawdown(stockPrices, effectiveD0Idx);

  // 상승/급락 여부
  const carD5 = cumulativeAR['d5'] ?? 0;
  const isUpD5 = carD5 > 0;
  const isCrashD5 = carD5 < -5;

  // 거래량 비율
  let volumeRatios: Record<string, number> = { d1: 1, d3: 1 };
  if (volumes && baselineVolumes) {
    volumeRatios = calcVolumeRatios(volumes, baselineVolumes, d0Date);
  }

  return {
    dailyReturns,
    marketReturns,
    dailyAR,
    cumulativeAR,
    maxDrawdown,
    isUpD5,
    isCrashD5,
    volumeRatios,
  };
}
