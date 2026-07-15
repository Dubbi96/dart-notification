/**
 * 기술지표 구간 조회(indicators) — 순수 파라미터 정규화·검증 (W13 데이터 자산 표면 개방).
 *
 * TechnicalIndicator(technical_indicators, @@unique([stockCode, tradeDate]))를
 * GET /market-data/candles 와 동일한 파라미터 규약(stockCode·from·to·before·limit)으로
 * 조회하기 위한 입력 정규화를 DB·시계와 분리한 순수 함수로 둔다(결정론적 단위 테스트 가능).
 *
 * tradeDate 는 'YYYYMMDD'(KST 거래일) 문자열이라 사전식 비교 == 시간 순서다. 구간(from/to/before)은
 * 캔들과 동일하게 ISO 8601 또는 compact(YYYYMMDD/YYYYMMDDHHmm)를 받아 KST 거래일로 환산한다
 * (candle-query 의 parseInstantMs·tradeDateFromMs 재사용 — 1d 캔들과 동일 환산 규칙 = 조인 정합).
 *
 * ★기간 제한: limit 으로 한 페이지 상한을 강제한다(모바일 대량 전송 방지 — 캔들과 동일 상한).
 */

import { parseInstantMs, tradeDateFromMs } from './candle-query';

/** 한 페이지 기본 지표 행 수(캔들과 동일 규약). */
export const DEFAULT_INDICATOR_LIMIT = 200;
/** 한 페이지 최대 지표 행 수(모바일 대량 전송 방지 상한, 캔들과 동일). */
export const MAX_INDICATOR_LIMIT = 1000;

/** 종목코드 6자리 숫자. */
const STOCK_CODE_RE = /^\d{6}$/;

export interface RawIndicatorQuery {
  stockCode?: string;
  /** 구간 시작(포함). ISO 8601 또는 YYYYMMDD / YYYYMMDDHHmm. */
  from?: string;
  /** 구간 끝(포함). */
  to?: string;
  /** 페이지네이션 커서 — 이 시각(거래일) '이전(미만)' 지표만 반환(과거 페이지). */
  before?: string;
  limit?: string | number;
}

export interface NormalizedIndicatorQuery {
  stockCode: string;
  /** 구간 시작 KST 거래일 'YYYYMMDD'(포함). 미지정이면 undefined. */
  fromTradeDate?: string;
  /** 구간 끝 KST 거래일 'YYYYMMDD'(포함). 미지정이면 undefined. */
  toTradeDate?: string;
  /** 커서 KST 거래일 'YYYYMMDD' — 미만(과거)만. 미지정이면 undefined. */
  beforeTradeDate?: string;
  limit: number;
}

/** 잘못된 입력을 알리는 에러(컨트롤러가 400 으로 매핑 — 캔들 CandleQueryError 와 동일 패턴). */
export class IndicatorQueryError extends Error {}

function clampLimit(raw: string | number | undefined): number {
  if (raw == null || raw === '') return DEFAULT_INDICATOR_LIMIT;
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n)) return DEFAULT_INDICATOR_LIMIT;
  const floored = Math.floor(n);
  if (floored < 1) return 1;
  if (floored > MAX_INDICATOR_LIMIT) return MAX_INDICATOR_LIMIT;
  return floored;
}

/**
 * 원시 쿼리 파라미터를 검증·정규화한다. 잘못된 입력은 IndicatorQueryError 로 던진다.
 * 시계·DB 비의존(순수).
 */
export function normalizeIndicatorQuery(
  raw: RawIndicatorQuery,
): NormalizedIndicatorQuery {
  const stockCode = (raw.stockCode ?? '').trim();
  if (!STOCK_CODE_RE.test(stockCode)) {
    throw new IndicatorQueryError('stockCode 는 6자리 숫자여야 합니다');
  }

  let fromMs: number | undefined;
  if (raw.from != null && String(raw.from).trim() !== '') {
    const parsed = parseInstantMs(raw.from);
    if (parsed == null) throw new IndicatorQueryError('from 형식이 올바르지 않습니다');
    fromMs = parsed;
  }

  let toMs: number | undefined;
  if (raw.to != null && String(raw.to).trim() !== '') {
    const parsed = parseInstantMs(raw.to);
    if (parsed == null) throw new IndicatorQueryError('to 형식이 올바르지 않습니다');
    toMs = parsed;
  }

  if (fromMs != null && toMs != null && fromMs > toMs) {
    throw new IndicatorQueryError('from 은 to 보다 이후일 수 없습니다');
  }

  let beforeMs: number | undefined;
  if (raw.before != null && String(raw.before).trim() !== '') {
    const parsed = parseInstantMs(raw.before);
    if (parsed == null)
      throw new IndicatorQueryError('before(커서) 형식이 올바르지 않습니다');
    beforeMs = parsed;
  }

  return {
    stockCode,
    fromTradeDate: fromMs != null ? tradeDateFromMs(fromMs) : undefined,
    toTradeDate: toMs != null ? tradeDateFromMs(toMs) : undefined,
    beforeTradeDate: beforeMs != null ? tradeDateFromMs(beforeMs) : undefined,
    limit: clampLimit(raw.limit),
  };
}
