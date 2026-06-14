// backend/src/disclosure-events/extractors/capital-increase.ts
// 유상증자 수치 추출 파서 (Rule/정규식 전용, AI 미사용)

import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';
import { computeDilutionRate } from '../../disclosure-documents/utils/dilution.util';

export interface CapitalIncreaseData {
  issueType: 'RIGHTS_OFFERING' | 'PUBLIC_OFFERING' | 'THIRD_PARTY' | 'UNKNOWN';
  fundingAmount: number | null;      // 조달 금액 (원)
  purpose: string[];                 // 자금 사용 목적 배열
  newShares: number | null;          // 신주 수
  existingShares: number | null;     // 기존 발행 주식 수
  dilutionRate: number | null;       // 파생값(SSOT): newShares / (newShares + existingShares) * 100, %
  issuePrice: number | null;         // 발행가액 (원/주)
  referencePrice: number | null;     // 기준주가 (원/주)
  discountRate: number | null;       // 파생값: (referencePrice - issuePrice) / referencePrice * 100
  thirdPartyName: string | null;     // 제3자배정 대상자 (해당 시)
  subscriptionDate: string | null;   // 청약일 YYYY-MM-DD
  listingDate: string | null;        // 상장 예정일 YYYY-MM-DD
  derivedDataMissing: boolean;
}

/**
 * parsedJson에서 유상증자 수치를 추출한다.
 *
 * 파생값:
 *   dilutionRate = newShares / (newShares + existingShares) * 100  (SSOT, %, 분모 0/null → null)
 *   discountRate = (referencePrice - issuePrice) / referencePrice * 100  (분모 0/null → null)
 */
export function extract(parsedJson: ParsedJson, reportName: string): CapitalIncreaseData {
  try {
    const newShares = parsedJson.newShares ?? null;
    const existingShares = parsedJson.existingShares ?? null;
    const fundingAmount = parsedJson.fundingAmount ?? null;

    // parsedJson.discountRate는 M1에서 이미 계산된 값(소수점 4자리).
    // 여기서는 issuePrice / referencePrice를 별도 추출 시도 없이
    // parsedJson의 discountRate를 활용한다 (정규화: 0.1 → 10.0%).
    const rawDiscount = parsedJson.discountRate ?? null;
    const discountRate =
      rawDiscount !== null
        ? // 소수점 비율(예: 0.1, -0.05)이면 *100. 음수(프리미엄)도 절대값으로 판정 (MAJOR 수정)
          Math.abs(rawDiscount) > 0 && Math.abs(rawDiscount) < 1
            ? round2(rawDiscount * 100)
            : round2(rawDiscount)
        : null;

    // dilutionRate: SSOT(DAR-246) — newShares / (newShares + existingShares) * 100, %
    const dilutionRate = computeDilutionRate(newShares, existingShares);

    // issueType: issueMethod 키워드로 분류
    const issueType = inferIssueType(parsedJson.issueMethod ?? null, reportName);

    // derivedDataMissing: dilutionRate 계산 불가 시 true
    const derivedDataMissing = dilutionRate === null;

    return {
      issueType,
      fundingAmount,
      purpose: [],   // 자금 사용 목적 표 추출 — DQ 파서 고도화 단계에서 구현
      newShares,
      existingShares,
      dilutionRate,
      issuePrice: null,       // 표에서 추출 — 고도화 단계
      referencePrice: null,   // 표에서 추출 — 고도화 단계
      discountRate,
      thirdPartyName: null,   // 표에서 추출 — 고도화 단계
      subscriptionDate: null,
      listingDate: null,
      derivedDataMissing,
    };
  } catch {
    return emptyResult();
  }
}

// ─── 내부 유틸 ──────────────────────────────────────────────────────────────

/**
 * issueMethod 문자열 또는 reportName에서 증자 방식 분류
 */
function inferIssueType(
  issueMethod: string | null,
  reportName: string,
): 'RIGHTS_OFFERING' | 'PUBLIC_OFFERING' | 'THIRD_PARTY' | 'UNKNOWN' {
  const text = [issueMethod ?? '', reportName].join(' ');
  if (/제3자\s*배정/.test(text)) return 'THIRD_PARTY';
  if (/주주\s*배정/.test(text)) return 'RIGHTS_OFFERING';
  if (/일반\s*공모/.test(text)) return 'PUBLIC_OFFERING';
  return 'UNKNOWN';
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function emptyResult(): CapitalIncreaseData {
  return {
    issueType: 'UNKNOWN',
    fundingAmount: null,
    purpose: [],
    newShares: null,
    existingShares: null,
    dilutionRate: null,
    issuePrice: null,
    referencePrice: null,
    discountRate: null,
    thirdPartyName: null,
    subscriptionDate: null,
    listingDate: null,
    derivedDataMissing: true,
  };
}
