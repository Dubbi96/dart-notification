// backend/src/disclosure-events/extractors/dividend.ts
// 현금·현물배당 수치 추출 파서 (Rule/정규식 전용, AI 미사용)

import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';

/**
 * 주당 배당금(dividendPerShare) 회수 경로 (DAR-345).
 * - DIRECT  : parsedJson.dividendPerShare 직접 매핑(정상 경로)
 * - DERIVED : 직접값 결측 시 배당총액(dividendTotal) / 발행주식수로 유도
 * - NONE    : 회수 실패(직접값·유도 모두 불가)
 */
export type DividendPerShareSource = 'DIRECT' | 'DERIVED' | 'NONE';

export interface DividendData {
  dividendPerShare: number | null;         // 주당 배당금 (원)
  dividendPerShareSource: DividendPerShareSource; // 주당 배당금 회수 경로 (DAR-345)
  previousDividendPerShare: number | null; // 전년 주당 배당금 (없으면 null)
  changeRate: number | null;               // 파생값: YoY 성장률
  dividendYield: number | null;            // 배당수익률 (%)
  dividendTotal: number | null;            // 배당금 총액 (원)
  recordDate: string | null;               // 배당기준일 YYYY-MM-DD
  paymentDate: string | null;              // 배당지급일 YYYY-MM-DD
  dividendType: 'CASH' | 'STOCK' | 'HYBRID'; // 배당 유형
  derivedDataMissing: boolean;
  // DAR-345: 주당 배당금이 결측이어도 배당총액 등 부분 단서가 있으면 true.
  //   상위 calcConfidence가 0.0(FAILED) 대신 NEEDS_REVIEW(0.70)로 회수한다.
  partialFieldsPresent: boolean;
}

/**
 * 발행주식수 대체 키 (DAR-345 DERIVED 유도용).
 * parsedJson 스키마에는 발행주식수 전용 필드가 없어, 원시 블롭에 평탄화된
 * 미매핑 라벨(영문 키·한글 라벨)을 순회 스캔한다.
 */
const ISSUED_SHARES_KEYS = [
  'totalIssuedShares',
  'issuedShares',
  'totalShares',
  'sharesOutstanding',
  'listedShares',
  'totalStockCount',
  '발행주식총수',
  '발행주식수',
  '상장주식수',
  '주식수',
  '주식총수',
] as const;

/**
 * parsedJson에서 배당 수치를 추출한다.
 *
 * - dividendYield: parsedJson 내 소수점 값(예: 0.025) → * 100 → 2.5%
 * - previousDividendPerShare: 현재 parsedJson에 없음 → changeRate = null
 * - dividendPerShare(DAR-345): 직접값 결측 시 dividendTotal / 발행주식수로 유도(DERIVED).
 *   날조가 아니라 (총배당 ÷ 주식수 = 주당배당) 항등식 기반 회수다.
 */
export function extract(parsedJson: ParsedJson, _reportName: string): DividendData {
  try {
    const raw = parsedJson as unknown as Record<string, unknown>;

    const dividendTotal = coerceAmount(parsedJson.dividendTotal);
    const recordDate = normalizeDate(parsedJson.dividendRecordDate ?? null);

    // dividendPerShare: DIRECT → DERIVED(dividendTotal / 발행주식수)
    const { perShare: dividendPerShare, source: dividendPerShareSource } =
      resolveDividendPerShare(parsedJson, raw, dividendTotal);

    // dividendYield: 소수점 4자리(예: 0.0250) → % 단위 변환
    const rawYield = parsedJson.dividendYield ?? null;
    const dividendYield =
      rawYield !== null ? round2(rawYield * 100) : null;

    // previousDividendPerShare는 현재 parsedJson 스키마에 없음
    const previousDividendPerShare = null;
    const changeRate = null; // 전년 데이터 미확보

    // docType 기반 배당 유형 판별
    const dividendType = inferDividendType(parsedJson.docType as string);

    const derivedDataMissing = previousDividendPerShare === null;

    // DAR-345: 주당배당 회수 실패여도 배당총액 단서가 있으면 NEEDS_REVIEW로 회수
    const partialFieldsPresent =
      dividendPerShare === null && dividendTotal !== null;

    return {
      dividendPerShare,
      dividendPerShareSource,
      previousDividendPerShare,
      changeRate,
      dividendYield,
      dividendTotal,
      recordDate,
      paymentDate: null, // 표에서 추출 — DQ 파서 고도화 단계에서 구현
      dividendType,
      derivedDataMissing,
      partialFieldsPresent,
    };
  } catch {
    return emptyResult();
  }
}

// ─── 내부 유틸 ──────────────────────────────────────────────────────────────

/**
 * 주당 배당금을 DIRECT → DERIVED 순으로 회수한다 (DAR-345).
 * DERIVED: dividendTotal / 발행주식수. 두 값이 모두 양수일 때만 유도한다.
 */
function resolveDividendPerShare(
  parsedJson: ParsedJson,
  raw: Record<string, unknown>,
  dividendTotal: number | null,
): { perShare: number | null; source: DividendPerShareSource } {
  // 1) DIRECT: 직접 매핑된 주당 배당금
  const direct = coercePositive(parsedJson.dividendPerShare);
  if (direct !== null) return { perShare: direct, source: 'DIRECT' };

  // 2) DERIVED: 배당총액 / 발행주식수
  if (dividendTotal !== null) {
    const shares = firstShares(raw, ISSUED_SHARES_KEYS);
    if (shares !== null && shares > 0) {
      const derived = Math.round(dividendTotal / shares);
      if (derived > 0) return { perShare: derived, source: 'DERIVED' };
    }
  }

  return { perShare: null, source: 'NONE' };
}

/** 키 목록을 순회하며 첫 양수 주식수를 회수 */
function firstShares(
  raw: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    const v = coercePositive(raw[key]);
    if (v !== null) return v;
  }
  return null;
}

function inferDividendType(docType: string | null | undefined): 'CASH' | 'STOCK' | 'HYBRID' {
  if (!docType) return 'CASH';
  if (/현물/.test(docType)) return 'STOCK';
  return 'CASH';
}

function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const dotSlash = raw.match(/^(\d{4})[./](\d{2})[./](\d{2})$/);
    if (dotSlash) return `${dotSlash[1]}-${dotSlash[2]}-${dotSlash[3]}`;
    const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    return null;
  } catch {
    return null;
  }
}

/**
 * 원 단위 양수 금액으로 강제 변환. 숫자/문자열('25,000,000,000', '250000000000원') 허용.
 * 0·음수·NaN·파싱불가 → null.
 */
function coerceAmount(value: unknown): number | null {
  return coercePositive(value);
}

/**
 * 양수 정수(주당배당·주식수·배당총액)로 강제 변환.
 * 숫자/문자열('500원', '12,345,678주') 허용. 0·음수·파싱불가 → null.
 */
function coercePositive(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? Math.round(value) : null;
  }
  if (typeof value === 'string') {
    const t = value.replace(/[,\s원주]/g, '');
    const m = t.match(/^(\d+(?:\.\d+)?)/);
    if (m) {
      const n = Math.round(parseFloat(m[1]));
      return n > 0 ? n : null;
    }
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyResult(): DividendData {
  return {
    dividendPerShare: null,
    dividendPerShareSource: 'NONE',
    previousDividendPerShare: null,
    changeRate: null,
    dividendYield: null,
    dividendTotal: null,
    recordDate: null,
    paymentDate: null,
    dividendType: 'CASH',
    derivedDataMissing: true,
    partialFieldsPresent: false,
  };
}
