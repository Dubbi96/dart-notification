/**
 * synthetic-price-feed.ts — 결정적·재현가능 합성 일봉 생성기 (DAR-124, 순수 함수)
 *
 * 배경: 환경 시계가 미래(2026)라 실 KRX API에 해당 일자 일봉이 없어
 *   `krx.daily lastSuccessAt=null` → 모의운용 신규 매수 0·신선 시세 공백(M10 졸업 게이트 직결).
 *   백필(b안)은 실 KRX '오늘'에도 데이터가 없어 동일 증상이라 구조적으로 막힌다.
 *   따라서 자급 가능한 결정적 합성 피드(a안)로 30일 트랙레코드가 의미를 갖게 한다.
 *
 * ★신뢰 원칙(불가침):
 *   - 여기서 만든 가격은 '모의/시뮬레이션' 전용이다. 실시세가 아니다.
 *   - 실데이터(StockDailyPrice)와 혼합하지 않는다 — 저장은 별도 테이블 SimulatedDailyPrice 로만.
 *   - 실시세 오인표시 금지: 합성 가격은 모의운용 평가에만 쓰이고, 기업 현재가/지표/신호 등
 *     실가격 표시 경로로 새지 않는다(이 모듈은 그 경로를 일절 건드리지 않는다).
 *
 * 결정성: 동일 (stockCode, tradeDate, 시작가)는 항상 동일 OHLCV.
 *   Date.now()/Math.random() 미사용 — 종목코드·거래일 해시로 시드된 PRNG만 사용.
 */

/** 합성 일봉 1행(저장/평가용). 모두 정수 원가(스키마 Int 정합). */
export interface SyntheticBar {
  /** 거래일 YYYYMMDD */
  tradeDate: string;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  /** 거래량(주) */
  volume: number;
}

/** FNV-1a 32bit 문자열 해시 — 시드 안정용(플랫폼 독립·결정적). */
export function hashSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // 32bit FNV prime 곱(오버플로우는 >>>0 으로 절단)
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — 시드 1개로 [0,1) 결정적 난수열 생성기. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 종목별 기준 시작가(거래일 무관) — 코드 해시로 1,000~200,000원 밴드에 결정적 배치.
 * 한국 상장주의 흔한 가격대를 대략 모사(실가격 아님).
 */
export function baseSeedPrice(stockCode: string): number {
  const r = mulberry32(hashSeed(`base:${stockCode}`))();
  const price = 1_000 + Math.floor(r * 199_000);
  // 10원 단위 호가 모사
  return Math.max(1_000, Math.round(price / 10) * 10);
}

/**
 * 종목별 일간 변동성 σ — 코드 해시로 1.2%~4.0% 밴드에 결정적 배치.
 * 종목마다 다른 변동성을 줘 트랙레코드가 평탄하지 않게 한다.
 */
export function stockVolatility(stockCode: string): number {
  const r = mulberry32(hashSeed(`vol:${stockCode}`))();
  return 0.012 + r * (0.04 - 0.012);
}

/** YYYYMMDD → Date(UTC 정오, 타임존 경계 안전). 형식 불량은 NaN Date. */
function parseYmd(yyyymmdd: string): Date {
  if (!/^\d{8}$/.test(yyyymmdd)) return new Date(NaN);
  const y = Number(yyyymmdd.slice(0, 4));
  const m = Number(yyyymmdd.slice(4, 6));
  const d = Number(yyyymmdd.slice(6, 8));
  return new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
}

function formatYmd(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** 거래일 여부 — 주말 제외(평일만). 공휴일은 합성이므로 단순화(미반영, 무해). */
export function isTradingDay(yyyymmdd: string): boolean {
  const dt = parseYmd(yyyymmdd);
  if (Number.isNaN(dt.getTime())) return false;
  const dow = dt.getUTCDay(); // 0=일,6=토
  return dow !== 0 && dow !== 6;
}

/** 직전 거래일(주말 스킵). */
export function prevTradingDay(yyyymmdd: string): string {
  const dt = parseYmd(yyyymmdd);
  do {
    dt.setUTCDate(dt.getUTCDate() - 1);
  } while (dt.getUTCDay() === 0 || dt.getUTCDay() === 6);
  return formatYmd(dt);
}

/**
 * endDate(포함, 거래일이면)에서 과거로 거래일 count개를 오름차순으로 반환.
 * endDate가 주말이면 직전 거래일부터 센다.
 */
export function tradingDaysEndingAt(endDate: string, count: number): string[] {
  if (count <= 0) return [];
  const out: string[] = [];
  let cursor = isTradingDay(endDate) ? endDate : prevTradingDay(endDate);
  for (let i = 0; i < count; i++) {
    out.push(cursor);
    cursor = prevTradingDay(cursor);
  }
  return out.reverse();
}

/** 일간 수익률 — date 시드로 [-σ, +σ] 균등(결정적). 종목별 σ 반영. */
function dailyReturn(stockCode: string, tradeDate: string, volatility: number): number {
  const r = mulberry32(hashSeed(`ret:${stockCode}:${tradeDate}`))();
  return (r - 0.5) * 2 * volatility;
}

const MIN_PRICE = 100; // 합성 하한가(원)

/**
 * 한 종목의 합성 시계열 생성 — 시작가에서 거래일마다 시드된 일간수익률로 워크.
 * tradeDates 는 오름차순 거래일 목록(tradingDaysEndingAt 산출). 결정적·재현가능.
 *
 * 같은 (stockCode, tradeDates, seedPrice) 입력은 항상 동일 출력(멱등 평가의 기반).
 */
export function generateSyntheticSeries(
  stockCode: string,
  tradeDates: string[],
  opts: { seedPrice?: number; volatility?: number } = {},
): SyntheticBar[] {
  const volatility = opts.volatility ?? stockVolatility(stockCode);
  let prevClose = Math.max(MIN_PRICE, Math.round(opts.seedPrice ?? baseSeedPrice(stockCode)));

  const bars: SyntheticBar[] = [];
  for (const tradeDate of tradeDates) {
    bars.push(buildBar(stockCode, tradeDate, prevClose, volatility));
    prevClose = bars[bars.length - 1].closePrice;
  }
  return bars;
}

/**
 * 단일 거래일 합성 OHLCV — 직전 종가 기준. 시작가만 알면 어떤 날짜든 독립 재현 가능.
 * 시드는 (stockCode, tradeDate) 하나로 고정 — 일중 변동/거래량 모두 같은 PRNG 스트림.
 */
export function buildBar(
  stockCode: string,
  tradeDate: string,
  prevClose: number,
  volatility: number,
): SyntheticBar {
  const rng = mulberry32(hashSeed(`bar:${stockCode}:${tradeDate}`));
  const base = Math.max(MIN_PRICE, Math.round(prevClose));

  const ret = dailyReturn(stockCode, tradeDate, volatility);
  const close = Math.max(MIN_PRICE, Math.round(base * (1 + ret)));

  // 시가: 직전 종가 대비 작은 갭(±σ/2)
  const gap = (rng() - 0.5) * volatility;
  const open = Math.max(MIN_PRICE, Math.round(base * (1 + gap)));

  // 일중 고저: open/close 범위를 σ/2 만큼 바깥으로 확장
  const wick = rng() * (volatility / 2);
  const hi = Math.max(open, close);
  const lo = Math.min(open, close);
  const high = Math.max(hi, Math.round(hi * (1 + wick)));
  const low = Math.max(MIN_PRICE, Math.min(lo, Math.round(lo * (1 - wick))));

  // 거래량: 10만~210만주 밴드(결정적)
  const volume = 100_000 + Math.floor(rng() * 2_000_000);

  return { tradeDate, openPrice: open, highPrice: high, lowPrice: low, closePrice: close, volume };
}
