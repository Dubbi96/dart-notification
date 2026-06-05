// backend/src/disclosure-events/extractors/cb-bw.ts
// 전환사채(CB)·신주인수권부사채(BW) 수치 추출 파서 (Rule/정규식 전용, AI 미사용)

import { ParsedJson } from '../../disclosure-documents/types/parsed-json.type';

export interface CbBwData {
  bondType: 'CB' | 'BW';                    // 사채 유형
  totalAmount: number | null;               // 발행 금액 (원)
  interestRate: number | null;              // 이자율 (소수점 4자리, 예: 0.0)
  maturityDate: string | null;              // 만기일 YYYY-MM-DD
  conversionPrice: number | null;           // 전환가액 (원/주)
  conversionPremiumRate: number | null;     // 파생값: (conversionPrice - referencePrice) / referencePrice * 100
  refixClause: boolean | null;              // 리픽싱 조항 여부
  earlyRedemptionDate: string | null;       // 조기상환 청구 가능일 YYYY-MM-DD
  allottee: string | null;                  // 발행 대상자
  allotteeType: 'INSTITUTIONAL' | 'INDIVIDUAL' | 'RELATED_PARTY' | 'UNKNOWN';
  maxDilutionShares: number | null;         // 파생값: floor(totalAmount / conversionPrice)
  maxDilutionRate: number | null;           // 파생값: maxDilutionShares / existingShares * 100
  derivedDataMissing: boolean;
}

/** 리픽싱 조항 관련 키워드 패턴 */
const REFIX_PATTERN = /리픽스|리픽싱|전환가액\s*조정|행사가액\s*조정/;

/**
 * parsedJson에서 CB/BW 수치를 추출한다.
 *
 * 파생값:
 *   conversionPremiumRate = (conversionPrice - referencePrice) / referencePrice * 100
 *   maxDilutionShares     = floor(totalAmount / conversionPrice)
 *   maxDilutionRate       = maxDilutionShares / existingShares * 100
 */
export function extract(parsedJson: ParsedJson, _reportName: string): CbBwData {
  try {
    // bondType: parsedJson.bondType 기반 (CB/BW/EB)
    const rawBondType = parsedJson.bondType ?? null;
    const bondType: 'CB' | 'BW' =
      rawBondType === 'BW' ? 'BW' : 'CB'; // EB 포함 나머지는 CB로 분류

    const totalAmount = parsedJson.issuanceAmount ?? null;
    const conversionPrice = parsedJson.conversionPrice ?? null;
    const maturityDate = normalizeDate(parsedJson.maturityDate ?? null);

    // interestRate: parsedJson 내 소수점 값 그대로 저장 (예: 0.0)
    const interestRate = parsedJson.interestRate ?? null;

    // refixClause: parsedJson 키워드 탐지 대상 없음 → rawText 미제공 → null
    // (고도화 단계에서 rawText 스캔으로 구현)
    const refixClause: boolean | null = null;

    // maxDilutionShares: floor(totalAmount / conversionPrice)
    const maxDilutionShares =
      totalAmount !== null && conversionPrice !== null && conversionPrice !== 0
        ? Math.floor(totalAmount / conversionPrice)
        : null;

    // maxDilutionRate: maxDilutionShares / existingShares * 100
    // existingShares는 현재 parsedJson 스키마에 없음 → null
    const maxDilutionRate: number | null = null;

    const derivedDataMissing =
      maxDilutionRate === null; // existingShares 미확보

    return {
      bondType,
      totalAmount,
      interestRate,
      maturityDate,
      conversionPrice,
      conversionPremiumRate: null,  // referencePrice 표 추출 — 고도화 단계
      refixClause,
      earlyRedemptionDate: null,    // 표 추출 — 고도화 단계
      allottee: null,               // 표 추출 — 고도화 단계
      allotteeType: 'UNKNOWN',
      maxDilutionShares,
      maxDilutionRate,
      derivedDataMissing,
    };
  } catch {
    return emptyResult();
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

function emptyResult(): CbBwData {
  return {
    bondType: 'CB',
    totalAmount: null,
    interestRate: null,
    maturityDate: null,
    conversionPrice: null,
    conversionPremiumRate: null,
    refixClause: null,
    earlyRedemptionDate: null,
    allottee: null,
    allotteeType: 'UNKNOWN',
    maxDilutionShares: null,
    maxDilutionRate: null,
    derivedDataMissing: true,
  };
}

// REFIX_PATTERN을 외부에서 사용할 수 있도록 export
export { REFIX_PATTERN };
