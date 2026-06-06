// backend/src/engine1-disclosure/disclosure-documents/facts/dart-filed-fact.normalizer.ts
// DAR-95: 기존 표 파싱 결과(ParsedJson) → 표준 factKey 정규화 (순수 Rule, AI 없음)
//
// 이미 받은 document.xml의 table.parser/key-value.mapper 산출물을 표준 키로 변환해
// DartFiledFact 영구 적재 입력을 만든다. 신규 외부 호출·AI 0.
// 결측 graceful — ParsedJson에 존재하는 필드만 fact로 산출(없으면 누락, 추정 금지).

import { ParsedJson } from '../types/parsed-json.type';

/** DartFiledFact 적재 입력 (id/timestamps 제외 — 영속 계층에서 부여) */
export interface FiledFactInput {
  factKey: string;
  /** 정규화 문자열 표현(숫자·날짜·텍스트 공통) */
  value: string;
  /** 숫자형 값(금액·수량·비율). 텍스트형은 undefined */
  numericValue?: number;
  /** 단위(원, 주, %, ratio 등). 결측 시 undefined */
  unit?: string;
  /** 기간/일자(YYYY-MM-DD 또는 원문 기간). 결측 시 undefined */
  period?: string;
  /** 추출 출처 경로(예: parsedJson.contractAmount) */
  sectionPath: string;
}

type FactKind = 'amount' | 'count' | 'ratio' | 'date' | 'text';

interface FactSpec {
  /** 표준 키 */
  factKey: string;
  /** 값 종류 — 단위·period 매핑 결정 */
  kind: FactKind;
  /** 단위 오버라이드(기본: amount=원, count=주, ratio=ratio, date/text=없음) */
  unit?: string;
}

/**
 * ParsedJson 필드명 → 표준 fact 사양 매핑 (KV-정규화 핵심 테이블).
 * 이슈 요구(계약금액/기간/상대방·CB전환가·증자 신주배정·배당성향 등)를
 * 현재 파이프라인이 실제 추출하는 필드 한도 내에서 표준화한다.
 * 미추출 필드(자금사용목적·리픽싱 등)는 파이프라인이 값을 만들면 자동 편입되도록
 * 매핑만 선반영하지 않고, 존재하는 값만 graceful 산출(추정 금지).
 */
export const FACT_KEY_MAP: Record<string, FactSpec> = {
  // ── 단일판매·공급계약 ─────────────────────────────
  contractAmount: { factKey: 'CONTRACT_AMOUNT', kind: 'amount' },
  recentSales: { factKey: 'RECENT_SALES', kind: 'amount' },
  salesRatio: { factKey: 'CONTRACT_TO_SALES_RATIO', kind: 'ratio' },
  counterparty: { factKey: 'COUNTERPARTY', kind: 'text' },
  contractStartDate: { factKey: 'CONTRACT_START_DATE', kind: 'date' },
  contractEndDate: { factKey: 'CONTRACT_END_DATE', kind: 'date' },

  // ── 자기주식 취득·소각 ───────────────────────────
  acquisitionShares: { factKey: 'ACQUISITION_SHARES', kind: 'count' },
  acquisitionAmount: { factKey: 'ACQUISITION_AMOUNT', kind: 'amount' },
  acquisitionMethod: { factKey: 'ACQUISITION_METHOD', kind: 'text' },
  acquisitionStartDate: { factKey: 'ACQUISITION_START_DATE', kind: 'date' },
  acquisitionEndDate: { factKey: 'ACQUISITION_END_DATE', kind: 'date' },
  cancellationShares: { factKey: 'CANCELLATION_SHARES', kind: 'count' },
  cancellationAmount: { factKey: 'CANCELLATION_AMOUNT', kind: 'amount' },

  // ── 배당 ─────────────────────────────────────────
  dividendTotal: { factKey: 'DIVIDEND_TOTAL', kind: 'amount' },
  dividendPerShare: { factKey: 'DIVIDEND_PER_SHARE', kind: 'amount' },
  dividendRecordDate: { factKey: 'DIVIDEND_RECORD_DATE', kind: 'date' },
  dividendYield: { factKey: 'DIVIDEND_PAYOUT_RATIO', kind: 'ratio' },

  // ── 유상증자(신주배정) ───────────────────────────
  newShares: { factKey: 'NEW_SHARES', kind: 'count' },
  fundingAmount: { factKey: 'FUNDING_AMOUNT', kind: 'amount' },
  issueMethod: { factKey: 'ISSUE_METHOD', kind: 'text' },
  discountRate: { factKey: 'DISCOUNT_RATE', kind: 'ratio' },
  existingShares: { factKey: 'EXISTING_SHARES', kind: 'count' },
  dilutionRate: { factKey: 'DILUTION_RATE', kind: 'ratio' },

  // ── 전환사채·신주인수권부사채 ────────────────────
  issuanceAmount: { factKey: 'BOND_ISSUANCE_AMOUNT', kind: 'amount' },
  conversionPrice: { factKey: 'CB_CONVERSION_PRICE', kind: 'amount' },
  interestRate: { factKey: 'BOND_INTEREST_RATE', kind: 'ratio' },
  maturityDate: { factKey: 'BOND_MATURITY_DATE', kind: 'date' },
  bondType: { factKey: 'BOND_TYPE', kind: 'text' },

  // ── 최대주주 변경 ────────────────────────────────
  newLargestShareholder: { factKey: 'NEW_LARGEST_SHAREHOLDER', kind: 'text' },
  previousLargestShareholder: {
    factKey: 'PREVIOUS_LARGEST_SHAREHOLDER',
    kind: 'text',
  },
  largestShareholderRatio: {
    factKey: 'LARGEST_SHAREHOLDER_RATIO',
    kind: 'ratio',
  },
  shareholderChangeReason: { factKey: 'SHAREHOLDER_CHANGE_REASON', kind: 'text' },
  shareholderChangeDate: { factKey: 'SHAREHOLDER_CHANGE_DATE', kind: 'date' },

  // ── 실적 ─────────────────────────────────────────
  revenue: { factKey: 'REVENUE', kind: 'amount' },
  operatingProfit: { factKey: 'OPERATING_PROFIT', kind: 'amount' },
  netProfit: { factKey: 'NET_PROFIT', kind: 'amount' },
  previousOperatingProfit: {
    factKey: 'PREVIOUS_OPERATING_PROFIT',
    kind: 'amount',
  },
  operatingProfitYoY: { factKey: 'OPERATING_PROFIT_YOY', kind: 'ratio' },

  // ── 소송 ─────────────────────────────────────────
  lawsuitAmount: { factKey: 'LAWSUIT_AMOUNT', kind: 'amount' },
  claimCause: { factKey: 'CLAIM_CAUSE', kind: 'text' },
  plaintiff: { factKey: 'PLAINTIFF', kind: 'text' },
  defendant: { factKey: 'DEFENDANT', kind: 'text' },
  litigationStage: { factKey: 'LITIGATION_STAGE', kind: 'text' },

  // ── 감사의견·거래정지·상폐·계약해제 ──────────────
  auditOpinionType: { factKey: 'AUDIT_OPINION_TYPE', kind: 'text' },
  auditOpinionReason: { factKey: 'AUDIT_OPINION_REASON', kind: 'text' },
  suspensionReason: { factKey: 'SUSPENSION_REASON', kind: 'text' },
  suspensionStartDate: { factKey: 'SUSPENSION_START_DATE', kind: 'date' },
  expectedResumeDate: { factKey: 'EXPECTED_RESUME_DATE', kind: 'date' },
  delistingStage: { factKey: 'DELISTING_STAGE', kind: 'text' },
  delistingReason: { factKey: 'DELISTING_REASON', kind: 'text' },
  cancelledContractAmount: {
    factKey: 'CANCELLED_CONTRACT_AMOUNT',
    kind: 'amount',
  },
  originalContractAmount: { factKey: 'ORIGINAL_CONTRACT_AMOUNT', kind: 'amount' },
  cancellationReason: { factKey: 'CANCELLATION_REASON', kind: 'text' },
};

/** ParsedJson의 메타 필드(정량 fact가 아님) — 정규화 제외 */
const META_FIELDS = new Set(['docType', 'rawTableCount', 'keyValueSource']);

function defaultUnit(kind: FactKind, spec: FactSpec): string | undefined {
  if (spec.unit !== undefined) return spec.unit;
  switch (kind) {
    case 'amount':
      return '원';
    case 'count':
      return '주';
    case 'ratio':
      return 'ratio';
    default:
      return undefined;
  }
}

/**
 * ParsedJson → 표준 FiledFactInput[] 정규화.
 *
 * - ParsedJson에 실제 존재하는(매핑된) 필드만 fact로 산출 — 결측 graceful, 추정 금지.
 * - null/undefined/빈문자 값은 건너뜀.
 * - 날짜형은 period에, 숫자형은 numericValue에 동봉.
 * - 입력이 비거나 매핑 대상이 전무하면 빈 배열.
 *
 * @param parsedJson DisclosureDocument.parsedJson (mapKeyValues 산출물)
 */
export function normalizeFiledFacts(
  parsedJson: ParsedJson | null | undefined,
): FiledFactInput[] {
  if (!parsedJson || typeof parsedJson !== 'object') return [];

  const facts: FiledFactInput[] = [];

  for (const [field, rawValue] of Object.entries(parsedJson)) {
    if (META_FIELDS.has(field)) continue;
    if (rawValue === null || rawValue === undefined) continue;

    const spec = FACT_KEY_MAP[field];
    if (!spec) continue; // 매핑되지 않은 필드는 무시(추정 금지)

    const isNumeric = typeof rawValue === 'number';
    const value = String(rawValue).trim();
    if (value === '') continue;
    if (isNumeric && Number.isNaN(rawValue as number)) continue;

    const fact: FiledFactInput = {
      factKey: spec.factKey,
      value,
      sectionPath: `parsedJson.${field}`,
    };

    const unit = defaultUnit(spec.kind, spec);
    if (unit !== undefined) fact.unit = unit;

    if (isNumeric) fact.numericValue = rawValue as number;

    if (spec.kind === 'date') {
      fact.period = value;
    }

    facts.push(fact);
  }

  return facts;
}
