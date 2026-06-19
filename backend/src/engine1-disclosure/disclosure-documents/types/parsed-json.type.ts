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

  // ── 최대주주 변경 (MAJOR_SHAREHOLDER_CHANGE) ─────────────
  // DAR-58: 보유 parsedJson에 존재할 때만 사용(없으면 null → NEEDS_REVIEW→AI L1)
  /** 변경 후 최대주주 */
  newLargestShareholder?: string;
  /** 변경 전 최대주주 */
  previousLargestShareholder?: string;
  /** 변경 후 최대주주 지분율 (소수점 4자리 또는 % 정수, 0.255 = 25.5%) */
  largestShareholderRatio?: number;
  /** 최대주주 변경 사유 (양수도·장내매수·상속·합병 등) */
  shareholderChangeReason?: string;
  /** 최대주주 변경일 YYYY-MM-DD */
  shareholderChangeDate?: string;

  // ── 실적 (EARNINGS_SURPRISE / EARNINGS_SHOCK) ────────────
  // DAR-58: 영업(잠정)실적·손익구조변동 공시 보유값 재사용
  /** 매출액 (원) */
  revenue?: number;
  /** 영업이익 (원, 음수=영업손실) */
  operatingProfit?: number;
  /** 당기순이익 (원, 음수=순손실) */
  netProfit?: number;
  /** 전년 동기 영업이익 (원) */
  previousOperatingProfit?: number;
  /** 영업이익 전년比 증감률 (소수점 4자리, 0.30 = +30%) */
  operatingProfitYoY?: number;

  // ── 소송 (LAWSUIT) ───────────────────────────────────────
  // DAR-71: 고위험 공시 5종. 보유 parsedJson(JSON 컬럼)에 존재할 때만 사용
  //         (없으면 null → 부분 추출 허용·상위 NEEDS_REVIEW). 스키마 변경 없음.
  /** 소송금액/청구금액 (원) */
  lawsuitAmount?: number;
  /** 청구원인/소송유형 원문 (손해배상·약정금·특허침해 등) */
  claimCause?: string;
  /** 원고 (소송 제기 측) */
  plaintiff?: string;
  /** 피고 (소송 피청구 측) */
  defendant?: string;
  /** 소송 진행단계 원문 (소제기·1심·항소·상고 등) */
  litigationStage?: string;

  // ── 감사의견 리스크 (AUDIT_OPINION_RISK) ─────────────────
  /** 감사의견 종류 원문 (한정·부적정·의견거절 등) */
  auditOpinionType?: string;
  /** 감사의견 사유 */
  auditOpinionReason?: string;

  // ── 거래정지 (TRADING_SUSPENSION) ────────────────────────
  /** 정지 사유 */
  suspensionReason?: string;
  /** 정지 시작일 YYYY-MM-DD */
  suspensionStartDate?: string;
  /** 예상 해제일 YYYY-MM-DD */
  expectedResumeDate?: string;

  // ── 상장폐지 위험 (DELISTING_RISK) ───────────────────────
  /** 상폐 단계 원문 (관리종목지정·실질심사·상폐결정·투자경고 등) */
  delistingStage?: string;
  /** 상폐 사유 */
  delistingReason?: string;

  // ── 대량보유(5%룰) 상황보고 (MAJOR_HOLDER_5PCT) ──────────
  // DAR-337: 보유 parsedJson에 존재할 때만 사용(없으면 null → NEEDS_REVIEW→AI L1/insider 보강).
  // 방향(증감 부호)의 정본은 정형 majorstock.json 수집 경로(InsiderHoldingChange)다.
  /** 대표보고자/보유자명 */
  holderName?: string;
  /** 변동 후 보유비율 (% 0~100, 또는 소수 비율 0<r<1) */
  holdingRatio?: number;
  /** 직전 보유비율 (% 0~100, 또는 소수 비율 0<r<1) */
  previousHoldingRatio?: number;
  /** 보유 주식등의 수 */
  heldShares?: number;
  /** 보유목적 원문 (경영참가·단순투자·일반투자 등) */
  holdingPurpose?: string;
  /** 보고사유 원문 (신규·변동·변경 등) */
  holdingReportReason?: string;

  // ── 계약 해제 (CONTRACT_CANCELLATION) ────────────────────
  /** 해제된 계약금액 (원) */
  cancelledContractAmount?: number;
  /** 기존(원) 계약금액 (원) — 해제 비율 산출용 */
  originalContractAmount?: number;
  /** 계약 해제 사유 */
  cancellationReason?: string;
  // counterparty(거래상대방)는 SUPPLY_CONTRACT 필드 재사용
}
