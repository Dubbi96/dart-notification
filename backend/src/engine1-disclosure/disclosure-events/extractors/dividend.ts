// backend/src/disclosure-events/extractors/dividend.ts
// 현금·현물배당 수치 추출 파서 (Rule/정규식 전용, AI 미사용)

import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';

export interface DividendData {
  dividendPerShare: number | null;         // 주당 배당금 (원)
  previousDividendPerShare: number | null; // 전년 주당 배당금 (없으면 null)
  changeRate: number | null;               // 파생값: YoY 성장률
  dividendYield: number | null;            // 배당수익률 (%)
  dividendTotal: number | null;            // 배당금 총액 (원)
  recordDate: string | null;               // 배당기준일 YYYY-MM-DD
  paymentDate: string | null;              // 배당지급일 YYYY-MM-DD
  dividendType: 'CASH' | 'STOCK' | 'HYBRID'; // 배당 유형
  derivedDataMissing: boolean;
}

/**
 * parsedJson에서 배당 수치를 추출한다.
 *
 * - dividendYield: parsedJson 내 소수점 값(예: 0.025) → * 100 → 2.5%
 * - previousDividendPerShare: 현재 parsedJson에 없음 → changeRate = null
 */
export function extract(parsedJson: ParsedJson, _reportName: string): DividendData {
  try {
    const dividendPerShare = parsedJson.dividendPerShare ?? null;
    const dividendTotal = parsedJson.dividendTotal ?? null;
    const recordDate = normalizeDate(parsedJson.dividendRecordDate ?? null);

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

    return {
      dividendPerShare,
      previousDividendPerShare,
      changeRate,
      dividendYield,
      dividendTotal,
      recordDate,
      paymentDate: null, // 표에서 추출 — DQ 파서 고도화 단계에서 구현
      dividendType,
      derivedDataMissing,
    };
  } catch {
    return emptyResult();
  }
}

// ─── 내부 유틸 ──────────────────────────────────────────────────────────────

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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyResult(): DividendData {
  return {
    dividendPerShare: null,
    previousDividendPerShare: null,
    changeRate: null,
    dividendYield: null,
    dividendTotal: null,
    recordDate: null,
    paymentDate: null,
    dividendType: 'CASH',
    derivedDataMissing: true,
  };
}
