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
  // DAR-340: 필수 수치(newShares·fundingAmount) 모두 부재여도 "유상증자 문서임"이
  //   문서 단서(docType·발행방식·부수 수치)로 확인되면 true. 상위 dispatcher가
  //   confidence 0.0(→FAILED) 대신 부분 confidence(0.7, NEEDS_REVIEW→AI L1 보강)로
  //   회수하는 신호다. 수치를 날조하지 않으며 라우팅만 바꾼다.
  partialFieldsPresent: boolean;
}

// DAR-340: parsedJson.docType이 아래에 속하면 파서가 "유상증자 표(발행주식수·모집금액
//   헤더 등)"를 식별했다는 뜻 → 분류 확실. 수치만 비어도 FAILED가 아니라 회수 대상.
const PAID_IN_CAPITAL_INCREASE_DOC_TYPES: ReadonlySet<string> = new Set([
  'PAID_IN_CAPITAL_INCREASE',
  'THIRD_PARTY_ALLOTMENT',
]);

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

    // DAR-538: 예정 이벤트 캘린더 — 청약일·신주 상장예정일. 형식 불일치는 null(발명 금지).
    const subscriptionDate = normalizeDate(parsedJson.subscriptionDate ?? null);
    const listingDate = normalizeDate(parsedJson.listingDate ?? null);

    // DAR-340: 부분 단서 존재 여부 — 필수 수치(newShares·fundingAmount)가 모두 비어도
    //   ①파서가 유상증자 문서로 식별(docType) ②발행방식 분류 가능(issueType≠UNKNOWN,
    //   "발행주식수+모집금액" 표 헤더 등에서 발행방식 단서) ③부수 수치(할인율·기존주식수·
    //   희석률) 존재 — 중 하나라도 있으면 "유상증자임은 확실, 수치만 부재"로 본다.
    //   FAILED(분류 불가) 대신 NEEDS_REVIEW(AI L1 수치 보강)로 회수하기 위한 신호.
    const partialFieldsPresent =
      PAID_IN_CAPITAL_INCREASE_DOC_TYPES.has(String(parsedJson.docType ?? '')) ||
      issueType !== 'UNKNOWN' ||
      discountRate !== null ||
      existingShares !== null ||
      dilutionRate !== null ||
      newShares !== null ||
      fundingAmount !== null ||
      // DAR-538: 청약일·상장예정일도 유상증자 문서 단서다(날짜만 추출돼도 회수 대상).
      subscriptionDate !== null ||
      listingDate !== null;

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
      subscriptionDate,
      listingDate,
      derivedDataMissing,
      partialFieldsPresent,
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

// DAR-538: dividend.ts normalizeDate와 동일 규약 — YYYY.MM.DD / YYYY/MM/DD /
//   YYYYMMDD / YYYY-MM-DD만 수용, 그 외 null (날짜 발명 금지).
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
    partialFieldsPresent: false,
  };
}
