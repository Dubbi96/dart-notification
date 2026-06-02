// backend/src/disclosure-events/extractors/supply-contract.ts
// 단일판매·공급계약 수치 추출 파서 (Rule/정규식 전용, AI 미사용)

import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';

export interface SupplyContractData {
  contractAmount: number | null;       // 계약금액 (원 단위 정규화)
  recentSales: number | null;          // 최근 매출액 (원)
  salesRatio: number | null;           // 파생값: contractAmount / recentSales * 100
  counterparty: string | null;         // 거래상대방
  counterpartyType: 'DOMESTIC_LARGE' | 'DOMESTIC_SME' | 'FOREIGN' | 'UNKNOWN';
  contractStartDate: string | null;    // YYYY-MM-DD
  contractEndDate: string | null;      // YYYY-MM-DD
  contractDurationMonths: number | null; // 파생값: 날짜 차이 (월)
  productOrService: string | null;     // 제품·서비스 설명
  isAmendment: boolean;
  derivedDataMissing: boolean;         // recentSales null 시 true
}

/**
 * parsedJson에서 단일판매·공급계약 수치를 추출한다.
 *
 * 공통 규칙:
 * - parsedJson 필드 직접 매핑 우선 → 없으면 null
 * - 금액 단위 정규화: 이미 parsedJson 내에서 원 단위 정규화됨 (key-value.mapper 책임)
 * - 날짜 정규화: YYYY.MM.DD / YYYY/MM/DD / YYYYMMDD → YYYY-MM-DD
 * - 예외 throw 금지 — try/catch 후 해당 필드 null 처리
 */
export function extract(parsedJson: ParsedJson, _reportName: string): SupplyContractData {
  try {
    const contractAmount = parsedJson.contractAmount ?? null;
    const recentSales = parsedJson.recentSales ?? null;
    const counterparty = parsedJson.counterparty ?? null;
    const contractStartDate = normalizeDate(parsedJson.contractStartDate ?? null);
    const contractEndDate = normalizeDate(parsedJson.contractEndDate ?? null);

    // 파생값: salesRatio
    const salesRatio =
      contractAmount !== null && recentSales !== null && recentSales !== 0
        ? round2(contractAmount / recentSales * 100)
        : null;

    // 파생값: contractDurationMonths
    const contractDurationMonths =
      contractStartDate && contractEndDate
        ? calcDurationMonths(contractStartDate, contractEndDate)
        : null;

    // 거래상대방 유형 추정 (단순 키워드 기반)
    const counterpartyType = inferCounterpartyType(counterparty);

    const derivedDataMissing = recentSales === null;

    return {
      contractAmount,
      recentSales,
      salesRatio,
      counterparty,
      counterpartyType,
      contractStartDate,
      contractEndDate,
      contractDurationMonths,
      productOrService: null, // rawText 추출은 DQ 파서 고도화 단계에서 구현
      isAmendment: false,     // Disclosure.rmk 기반 판별은 서비스 레이어에서 처리
      derivedDataMissing,
    };
  } catch {
    // 파서 오류 시 빈 결과 반환 (throw 금지)
    return emptyResult();
  }
}

// ─── 내부 유틸 ──────────────────────────────────────────────────────────────

/**
 * 날짜 문자열을 YYYY-MM-DD 형식으로 정규화
 * 지원: YYYY.MM.DD / YYYY/MM/DD / YYYYMMDD / YYYY-MM-DD
 */
function normalizeDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    // YYYY.MM.DD 또는 YYYY/MM/DD
    const dotSlash = raw.match(/^(\d{4})[./](\d{2})[./](\d{2})$/);
    if (dotSlash) return `${dotSlash[1]}-${dotSlash[2]}-${dotSlash[3]}`;

    // YYYYMMDD
    const compact = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;

    // 이미 YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

    return null;
  } catch {
    return null;
  }
}

/** 두 날짜 사이의 개월 수 (Math.round) */
function calcDurationMonths(start: string, end: string): number | null {
  try {
    const s = new Date(start);
    const e = new Date(end);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return null;
    const diffMs = e.getTime() - s.getTime();
    const diffMonths = diffMs / (1000 * 60 * 60 * 24 * 30.4375);
    return Math.round(diffMonths);
  } catch {
    return null;
  }
}

/** 거래상대방명으로 유형 추정 */
function inferCounterpartyType(
  name: string | null,
): 'DOMESTIC_LARGE' | 'DOMESTIC_SME' | 'FOREIGN' | 'UNKNOWN' {
  if (!name) return 'UNKNOWN';
  // 외국 법인 키워드 (Inc., Corp., Ltd. 등 영문 포함)
  if (/[A-Za-z]{3,}|Inc\.|Corp\.|Ltd\.|LLC|GmbH/.test(name)) return 'FOREIGN';
  return 'UNKNOWN';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyResult(): SupplyContractData {
  return {
    contractAmount: null,
    recentSales: null,
    salesRatio: null,
    counterparty: null,
    counterpartyType: 'UNKNOWN',
    contractStartDate: null,
    contractEndDate: null,
    contractDurationMonths: null,
    productOrService: null,
    isAmendment: false,
    derivedDataMissing: true,
  };
}
