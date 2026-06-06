// backend/src/disclosure-events/extractors/share-buyback.ts
// 자기주식 취득·소각 수치 추출 파서 (Rule/정규식 전용, AI 미사용)

import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';

export interface ShareBuybackData {
  buybackAmount: number | null;        // 취득 금액 (원)
  buybackShares: number | null;        // 취득 주식 수
  buybackRatioToTotal: number | null;  // 파생값: buybackShares / totalIssuedShares * 100
  // DAR-79: 동일 취득금액이라도 기업 규모 대비 임팩트가 다르다 → 정규화 비율.
  //   supply-contract.salesRatio(계약금액/매출) 패턴을 그대로 따른다.
  //   결측(매출/시총 미확보) 시 graceful null.
  buybackRatioToSales: number | null;    // 파생값: buybackAmount / 매출액 * 100 (소수 2자리)
  buybackRatioToMarketCap: number | null; // 파생값: buybackAmount / 시총 * 100 (소수 2자리)
  buybackPriceMax: number | null;      // 취득 단가 상한
  buybackPriceMin: number | null;      // 취득 단가 하한
  buybackPeriodStart: string | null;   // YYYY-MM-DD
  buybackPeriodEnd: string | null;     // YYYY-MM-DD
  acquisitionMethod: string | null;    // 취득 방법
  purpose: string | null;             // 목적
  derivedDataMissing: boolean;         // 정규화 비율(매출/시총)을 하나도 못 구했을 때 true
}

export interface ShareCancellationData {
  cancellationShares: number | null;   // 소각 주식 수
  cancellationAmount: number | null;   // 소각 금액 (원)
  cancellationRatioToTotal: number | null; // 파생값
  purpose: string | null;
  derivedDataMissing: boolean;
}

/** 취득금액 정규화 비율 묶음 (DAR-79). 결측은 null. */
export interface BuybackNormalizedRatios {
  buybackRatioToSales: number | null;
  buybackRatioToMarketCap: number | null;
  /** 매출·시총 어느 것으로도 정규화하지 못했으면 true */
  derivedDataMissing: boolean;
}

/**
 * 취득금액을 매출액·시총 대비 상대지표로 정규화한다 (DAR-79).
 *
 * - 단일 진실원천(SSOT): 추출기(engine1)와 신호생성(engine3)이 동일 공식을 공유하도록 export.
 * - 결측·0·음수 매출/시총은 graceful null (예외 throw 금지).
 * - 한계: 상장주식수 필드가 스키마에 없어 시총은 호출부가 (종가×주식수)로 구해 넘길 때만 산출된다.
 *   parsedJson 단독 추출 경로에서는 시총 입력이 없어 buybackRatioToMarketCap = null.
 */
export function computeBuybackRatios(
  buybackAmount: number | null | undefined,
  revenue: number | null | undefined,
  marketCap: number | null | undefined,
): BuybackNormalizedRatios {
  const amount =
    typeof buybackAmount === 'number' && isFinite(buybackAmount) ? buybackAmount : null;

  const buybackRatioToSales =
    amount !== null && typeof revenue === 'number' && isFinite(revenue) && revenue > 0
      ? round2((amount / revenue) * 100)
      : null;

  const buybackRatioToMarketCap =
    amount !== null && typeof marketCap === 'number' && isFinite(marketCap) && marketCap > 0
      ? round2((amount / marketCap) * 100)
      : null;

  return {
    buybackRatioToSales,
    buybackRatioToMarketCap,
    derivedDataMissing: buybackRatioToSales === null && buybackRatioToMarketCap === null,
  };
}

/**
 * parsedJson에서 자기주식 취득 수치를 추출한다.
 * - totalIssuedShares는 현 parsedJson 스키마에 없으므로 buybackRatioToTotal = null.
 * - DAR-79: buybackAmount를 매출(parsedJson.revenue) 대비로 정규화한다(supply-contract 패턴).
 *   parsedJson에는 시총·상장주식수 필드가 없어 buybackRatioToMarketCap은 null이며,
 *   매출 대비 비율도 매출 결측 시 null(engine3에서 CompanyFinancial로 보강).
 */
export function extract(parsedJson: ParsedJson, _reportName: string): ShareBuybackData {
  try {
    const buybackAmount = parsedJson.acquisitionAmount ?? null;
    const buybackShares = parsedJson.acquisitionShares ?? null;
    const buybackPeriodStart = normalizeDate(parsedJson.acquisitionStartDate ?? null);
    const buybackPeriodEnd = normalizeDate(parsedJson.acquisitionEndDate ?? null);
    const acquisitionMethod = parsedJson.acquisitionMethod ?? null;

    // 정규화 비율: 매출(parsedJson.revenue)만 추출 경로에서 가용. 시총은 parsedJson 미보유 → null.
    const ratios = computeBuybackRatios(buybackAmount, parsedJson.revenue ?? null, null);

    return {
      buybackAmount,
      buybackShares,
      buybackRatioToTotal: null, // totalIssuedShares 미확보
      buybackRatioToSales: ratios.buybackRatioToSales,
      buybackRatioToMarketCap: ratios.buybackRatioToMarketCap,
      buybackPriceMax: null,     // 표에서 추출 — DQ 파서 고도화 단계에서 구현
      buybackPriceMin: null,
      buybackPeriodStart,
      buybackPeriodEnd,
      acquisitionMethod,
      purpose: null,             // 표에서 추출 — DQ 파서 고도화 단계에서 구현
      derivedDataMissing: ratios.derivedDataMissing,
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyBuybackResult(): ShareBuybackData {
  return {
    buybackAmount: null,
    buybackShares: null,
    buybackRatioToTotal: null,
    buybackRatioToSales: null,
    buybackRatioToMarketCap: null,
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
