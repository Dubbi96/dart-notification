/**
 * 분봉/일봉 구간 조회(candles) — 순수 파라미터 정규화·검증 (DAR-378).
 *
 * TimescaleDB 하이퍼테이블(stock_minute_prices) + 연속집계(stock_candles_5m/15m/1d)를
 * from~to 구간 + 해상도(1m/5m/15m/1d) + 페이지네이션 + 서버측 다운샘플로 조회하기 위한
 * 입력 정규화 로직을 DB·시계와 분리한 순수 함수로 둔다(결정론적 단위 테스트 가능).
 *
 * ★모바일에 원본 분봉 대량 전송 금지: limit 으로 다운샘플 상한을 강제하고, 해상도가 높을수록
 *   연속집계 뷰를 조회해 원본 풀스캔을 피한다(응답 효율 레이어).
 *
 * 보안: 해상도→관계/시간컬럼 매핑은 고정 화이트리스트라 식별자 주입에 안전하다. stockCode·
 *   from·to·before·limit 은 호출부에서 파라미터 바인딩(Prisma.sql)으로 전달한다.
 */

export type CandleResolution = '1m' | '5m' | '15m' | '1d';

export const CANDLE_RESOLUTIONS: readonly CandleResolution[] = [
  '1m',
  '5m',
  '15m',
  '1d',
] as const;

export const DEFAULT_CANDLE_RESOLUTION: CandleResolution = '1m';

/** 한 페이지 기본 캔들 수. */
export const DEFAULT_CANDLE_LIMIT = 200;
/** 한 페이지 최대 캔들 수(모바일 대량 전송 방지 상한). */
export const MAX_CANDLE_LIMIT = 1000;

/** 종목코드 6자리 숫자. */
const STOCK_CODE_RE = /^\d{6}$/;

/** 해상도별 조회 대상 관계(하이퍼테이블/연속집계 뷰)와 시간 컬럼 — 고정 화이트리스트. */
export interface CandleSource {
  /** 조회 관계명(테이블/머티리얼라이즈드 뷰). */
  relation: string;
  /** 버킷 시간 컬럼명. */
  timeColumn: string;
  /**
   * 조회 방식(DAR-384):
   * - 'minute': TimescaleDB 하이퍼테이블/연속집계(timeColumn=timestamp instant). 분봉 수집 이후만 커버.
   * - 'daily' : KRX 일봉 캐노니컬 소스 stock_daily_prices(timeColumn=tradeDate 'YYYYMMDD' 문자열).
   *             과거 딥히스토리(StockDailyPrice 백필)를 1d 의 캐노니컬 소스로 서빙한다.
   */
  kind: 'minute' | 'daily';
}

// 1d 일봉의 캐노니컬 소스는 KRX 딥히스토리(stock_daily_prices)다(DAR-384). 분봉 롤업 1d
// (stock_candles_1d)는 분봉 수집 시작 이후(forward)만 커버하므로 과거 일봉을 못 본다 → 백필한
// StockDailyPrice 를 1d 의 권위 소스로 둔다. 5m/15m/1m 는 기존 분봉 하이퍼테이블/연속집계 유지.
const CANDLE_SOURCES: Record<CandleResolution, CandleSource> = {
  '1m': { relation: 'stock_minute_prices', timeColumn: 'ts', kind: 'minute' },
  '5m': { relation: 'stock_candles_5m', timeColumn: 'bucket', kind: 'minute' },
  '15m': { relation: 'stock_candles_15m', timeColumn: 'bucket', kind: 'minute' },
  '1d': { relation: 'stock_daily_prices', timeColumn: 'tradeDate', kind: 'daily' },
};

export function resolveCandleSource(resolution: CandleResolution): CandleSource {
  return CANDLE_SOURCES[resolution];
}

export interface RawCandleQuery {
  stockCode?: string;
  resolution?: string;
  /** 구간 시작(포함). ISO 8601 또는 YYYYMMDD / YYYYMMDDHHmm. */
  from?: string;
  /** 구간 끝(포함). */
  to?: string;
  /** 페이지네이션 커서 — 이 시각 '이전(미만)' 캔들만 반환(과거 페이지). */
  before?: string;
  limit?: string | number;
}

export interface NormalizedCandleQuery {
  stockCode: string;
  resolution: CandleResolution;
  source: CandleSource;
  /** 구간 시작 epoch ms(포함). 미지정이면 undefined. */
  fromMs?: number;
  /** 구간 끝 epoch ms(포함). 미지정이면 undefined. */
  toMs?: number;
  /** 커서 epoch ms — 미만(과거)만. 미지정이면 undefined. */
  beforeMs?: number;
  limit: number;
}

/** 잘못된 입력을 알리는 에러(컨트롤러가 400 으로 매핑). */
export class CandleQueryError extends Error {}

/**
 * ISO 8601 또는 compact(YYYYMMDD=8자리, YYYYMMDDHHmm=12자리, YYYYMMDDHHmmss=14자리)를
 * epoch ms 로 파싱한다. 파싱 불가 시 null.
 * compact 형식은 UTC 로 해석한다(저장 ts 가 UTC instant).
 */
export function parseInstantMs(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s.length === 0) return null;

  // compact 숫자 형식
  if (/^\d{8}$/.test(s) || /^\d{12}$/.test(s) || /^\d{14}$/.test(s)) {
    const year = Number(s.slice(0, 4));
    const month = Number(s.slice(4, 6));
    const day = Number(s.slice(6, 8));
    const hour = s.length >= 12 ? Number(s.slice(8, 10)) : 0;
    const minute = s.length >= 12 ? Number(s.slice(10, 12)) : 0;
    const second = s.length >= 14 ? Number(s.slice(12, 14)) : 0;
    if (
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > 31 ||
      hour > 23 ||
      minute > 59 ||
      second > 59
    ) {
      return null;
    }
    const ms = Date.UTC(year, month - 1, day, hour, minute, second);
    return Number.isNaN(ms) ? null : ms;
  }

  // ISO 8601
  const ms = Date.parse(s);
  return Number.isNaN(ms) ? null : ms;
}

function clampLimit(raw: string | number | undefined): number {
  if (raw == null || raw === '') return DEFAULT_CANDLE_LIMIT;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return DEFAULT_CANDLE_LIMIT;
  const floored = Math.floor(n);
  if (floored < 1) return 1;
  if (floored > MAX_CANDLE_LIMIT) return MAX_CANDLE_LIMIT;
  return floored;
}

/**
 * 원시 쿼리 파라미터를 검증·정규화한다. 잘못된 입력은 CandleQueryError 로 던진다.
 * 시계·DB 비의존(순수).
 */
export function normalizeCandleQuery(
  raw: RawCandleQuery,
): NormalizedCandleQuery {
  const stockCode = (raw.stockCode ?? '').trim();
  if (!STOCK_CODE_RE.test(stockCode)) {
    throw new CandleQueryError('stockCode 는 6자리 숫자여야 합니다');
  }

  const resolutionRaw = (raw.resolution ?? DEFAULT_CANDLE_RESOLUTION).trim();
  if (!CANDLE_RESOLUTIONS.includes(resolutionRaw as CandleResolution)) {
    throw new CandleQueryError(
      `resolution 은 ${CANDLE_RESOLUTIONS.join('|')} 중 하나여야 합니다`,
    );
  }
  const resolution = resolutionRaw as CandleResolution;

  let fromMs: number | undefined;
  if (raw.from != null && String(raw.from).trim() !== '') {
    const parsed = parseInstantMs(raw.from);
    if (parsed == null) throw new CandleQueryError('from 형식이 올바르지 않습니다');
    fromMs = parsed;
  }

  let toMs: number | undefined;
  if (raw.to != null && String(raw.to).trim() !== '') {
    const parsed = parseInstantMs(raw.to);
    if (parsed == null) throw new CandleQueryError('to 형식이 올바르지 않습니다');
    toMs = parsed;
  }

  if (fromMs != null && toMs != null && fromMs > toMs) {
    throw new CandleQueryError('from 은 to 보다 이후일 수 없습니다');
  }

  let beforeMs: number | undefined;
  if (raw.before != null && String(raw.before).trim() !== '') {
    const parsed = parseInstantMs(raw.before);
    if (parsed == null)
      throw new CandleQueryError('before(커서) 형식이 올바르지 않습니다');
    beforeMs = parsed;
  }

  return {
    stockCode,
    resolution,
    source: resolveCandleSource(resolution),
    fromMs,
    toMs,
    beforeMs,
    limit: clampLimit(raw.limit),
  };
}

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * epoch ms(UTC instant) → KST 거래일 'YYYYMMDD' (DAR-384, 일봉 소스 stock_daily_prices 필터용).
 * tradeDate 는 KST 벽시계 거래일이므로, 구간(from/to/before)을 일봉 테이블에 적용하려면 KST
 * 달력일로 환산해야 한다. ★일봉 캔들의 time(자정 UTC = 09:00 KST 같은 날)을 커서로 되넘겨도
 * 같은 거래일로 환산돼 `< tradeDate` 페이지네이션이 정확히 이어진다.
 */
export function tradeDateFromMs(ms: number): string {
  const kst = new Date(ms + KST_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
  const d = String(kst.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * 거래일 'YYYYMMDD'(KST) → 대표 instant Date(자정 UTC). 일봉 1캔들의 time 으로 일관 반환한다
 * (분봉과 동일하게 ISO 8601 UTC). 형식 불량이면 null.
 */
export function dateFromTradeDate(tradeDate: string): Date | null {
  if (!/^\d{8}$/.test(tradeDate)) return null;
  const y = Number(tradeDate.slice(0, 4));
  const m = Number(tradeDate.slice(4, 6));
  const d = Number(tradeDate.slice(6, 8));
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const ms = Date.UTC(y, m - 1, d);
  return Number.isNaN(ms) ? null : new Date(ms);
}
