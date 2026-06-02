// backend/src/disclosure-events/extractors/share-buyback.ts
// 자기주식 취득·소각 수치 추출 파서 (Rule/정규식 전용, AI 미사용)

import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';

export interface ShareBuybackData {
  buybackAmount: number | null;        // 취득 금액 (원)
  buybackShares: number | null;        // 취득 주식 수
  buybackRatioToTotal: number | null;  // 파생값: buybackShares / totalIssuedShares * 100
  buybackPriceMax: number | null;      // 취득 단가 상한
  buybackPriceMin: number | null;      // 취득 단가 하한
  buybackPeriodStart: string | null;   // YYYY-MM-DD
  buybackPeriodEnd: string | null;     // YYYY-MM-DD
  acquisitionMethod: string | null;    // 취득 방법
  purpose: string | null;             // 목적
  derivedDataMissing: boolean;         // totalIssuedShares 미확보 시 true
}

export interface ShareCancellationData {
  cancellationShares: number | null;   // 소각 주식 수
  cancellationAmount: number | null;   // 소각 금액 (원)
  cancellationRatioToTotal: number | null; // 파생값
  purpose: string | null;
  derivedDataMissing: boolean;
}

/**
 * parsedJson에서 자기주식 취득 수치를 추출한다.
 * totalIssuedShares는 현재 parsedJson에 없으므로 buybackRatioToTotal = null
 */
export function extract(parsedJson: ParsedJson, _reportName: string): ShareBuybackData {
  try {
    const buybackAmount = parsedJson.acquisitionAmount ?? null;
    const buybackShares = parsedJson.acquisitionShares ?? null;
    const buybackPeriodStart = normalizeDate(parsedJson.acquisitionStartDate ?? null);
    const buybackPeriodEnd = normalizeDate(parsedJson.acquisitionEndDate ?? null);
    const acquisitionMethod = parsedJson.acquisitionMethod ?? null;

    // totalIssuedShares는 현 parsedJson 스키마에 없음 → 파생값 null
    const derivedDataMissing = true;

    return {
      buybackAmount,
      buybackShares,
      buybackRatioToTotal: null, // totalIssuedShares 미확보
      buybackPriceMax: null,     // 표에서 추출 — DQ 파서 고도화 단계에서 구현
      buybackPriceMin: null,
      buybackPeriodStart,
      buybackPeriodEnd,
      acquisitionMethod,
      purpose: null,             // 표에서 추출 — DQ 파서 고도화 단계에서 구현
      derivedDataMissing,
    };
  } catch {
    return emptyBuybackResult();
  }
}

/**
 * parsedJson에서 자기주식 소각 수치를 추출한다.
 */
export function extractCancellation(
  parsedJson: ParsedJson,
  _reportName: string,
): ShareCancellationData {
  try {
    const cancellationShares = parsedJson.cancellationShares ?? null;
    const cancellationAmount = parsedJson.cancellationAmount ?? null;
    const derivedDataMissing = true; // totalIssuedShares 미확보

    return {
      cancellationShares,
      cancellationAmount,
      cancellationRatioToTotal: null, // totalIssuedShares 미확보
      purpose: null,
      derivedDataMissing,
    };
  } catch {
    return emptyCancellationResult();
  }
}

// ─── 내부 유틸 ──────────────────────────────────────────────────────────────

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

function emptyBuybackResult(): ShareBuybackData {
  return {
    buybackAmount: null,
    buybackShares: null,
    buybackRatioToTotal: null,
    buybackPriceMax: null,
    buybackPriceMin: null,
    buybackPeriodStart: null,
    buybackPeriodEnd: null,
    acquisitionMethod: null,
    purpose: null,
    derivedDataMissing: true,
  };
}

function emptyCancellationResult(): ShareCancellationData {
  return {
    cancellationShares: null,
    cancellationAmount: null,
    cancellationRatioToTotal: null,
    purpose: null,
    derivedDataMissing: true,
  };
}
