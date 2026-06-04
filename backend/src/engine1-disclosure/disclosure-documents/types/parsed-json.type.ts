// backend/src/disclosure-documents/types/parsed-json.type.ts
import { InvestmentEventType } from '../../disclosures/constants/disclosure-types.constant';

/**
 * 파싱 결과 핵심 key-value 구조 (Phase 3 DisclosureEvent 입력 중간 산출물)
 * AI 최소 입력 원칙: 이 구조가 Phase 4 AI의 기본 입력이 된다.
 */
export interface ParsedJson {
  /** 투자이벤트 타입 (InvestmentEventType 값, null이면 비투자이벤트) */
  docType: InvestmentEventType | string;
  /** 추출된 전체 표 개수 */
  rawTableCount: number;
  /** key-value를 추출한 표 인덱스 (예: "table_0", 없으면 "none") */
  keyValueSource: string;

  // ── 단일판매·공급계약 (SUPPLY_CONTRACT) ──────────────────
  /** 계약금액 (원) */
  contractAmount?: number;
  /** 최근 매출액 (원) */
  recentSales?: number;
  /** 계약금액/매출액 비율 (소수점 4자리) */
  salesRatio?: number;
  /** 거래상대방 */
  counterparty?: string;
  /** 계약 기간 시작일 YYYY-MM-DD */
  contractStartDate?: string;
  /** 계약 기간 종료일 YYYY-MM-DD */
  contractEndDate?: string;

  // ── 자기주식 취득·소각 (SHARE_BUYBACK / SHARE_CANCELLATION) ──
  /** 취득 주식 수 */
  acquisitionShares?: number;
  /** 취득 금액 (원) */
  acquisitionAmount?: number;
  /** 취득 방법 (장내매수, 공개매수 등) */
  acquisitionMethod?: string;
  /** 취득 기간 시작일 YYYY-MM-DD */
  acquisitionStartDate?: string;
  /** 취득 기간 종료일 YYYY-MM-DD */
  acquisitionEndDate?: string;
  /** 소각 예정 주식 수 */
  cancellationShares?: number;
  /** 소각 예정 금액 (원) */
  cancellationAmount?: number;

  // ── 현금·현물배당 (DIVIDEND) ─────────────────────────────
  /** 배당금 총액 (원) */
  dividendTotal?: number;
  /** 주당 배당금 (원) */
  dividendPerShare?: number;
  /** 배당기준일 YYYY-MM-DD */
  dividendRecordDate?: string;
  /** 배당수익률 (소수점 4자리) */
  dividendYield?: number;

  // ── 유상증자 (PAID_IN_CAPITAL_INCREASE) ──────────────────
  /** 신규 발행 주식 수 */
  newShares?: number;
  /** 조달 금액 (원) */
  fundingAmount?: number;
  /** 발행 방법 (주주배정, 제3자배정, 일반공모) */
  issueMethod?: string;
  /** 할인율 (소수점 4자리) */
  discountRate?: number;
  /** 기존 발행 주식 수 */
  existingShares?: number;
  /** 희석률 = newShares / (newShares + existingShares) */
  dilutionRate?: number;

  // ── 전환사채·신주인수권부사채 (CB_BW_ISSUANCE) ───────────
  /** 발행 금액 (원) */
  issuanceAmount?: number;
  /** 전환가액 (원/주) */
  conversionPrice?: number;
  /** 이자율 (소수점 4자리) */
  interestRate?: number;
  /** 만기일 YYYY-MM-DD */
  maturityDate?: string;
  /** 사채 유형 'CB' | 'BW' | 'EB' */
  bondType?: string;
}
