// 공시 본문 정량 fact(DartFiledFact, DAR-95 적재)의 평문 라벨·단위 포맷 매핑(DAR-112).
// 백엔드 FACT_KEY_MAP의 표준 factKey를 한국어 라벨로 변환하고, 저장된 unit 기준으로 값을 포맷한다.
//  - 금액(unit '원')은 억/만원 단위로 압축, 비율(unit 'ratio')은 % 표기.
//  - 숫자형은 numericValue, 텍스트·날짜형은 value를 사용.
//  - 미등재 factKey도 값은 그대로 노출(정량 근거 투명화 — 조용히 버리지 않음).

import type { FiledFact } from '@app-types/disclosure.types';

// 표준 factKey → 한국어 라벨(백엔드 normalizer FACT_KEY_MAP 기준).
const FACT_LABEL: Record<string, string> = {
  // 공급계약
  CONTRACT_AMOUNT: '계약금액',
  RECENT_SALES: '최근 매출액',
  CONTRACT_TO_SALES_RATIO: '매출 대비 비중',
  COUNTERPARTY: '계약상대',
  CONTRACT_START_DATE: '계약 시작일',
  CONTRACT_END_DATE: '계약 종료일',
  // 자기주식 취득·소각
  ACQUISITION_SHARES: '취득 주식수',
  ACQUISITION_AMOUNT: '취득금액',
  ACQUISITION_METHOD: '취득방법',
  ACQUISITION_START_DATE: '취득 시작일',
  ACQUISITION_END_DATE: '취득 종료일',
  CANCELLATION_SHARES: '소각 주식수',
  CANCELLATION_AMOUNT: '소각금액',
  // 배당
  DIVIDEND_TOTAL: '배당총액',
  DIVIDEND_PER_SHARE: '주당 배당금',
  DIVIDEND_RECORD_DATE: '배당 기준일',
  DIVIDEND_PAYOUT_RATIO: '배당성향',
  // 유상증자
  NEW_SHARES: '신주 수',
  FUNDING_AMOUNT: '조달금액',
  ISSUE_METHOD: '발행방법',
  DISCOUNT_RATE: '할인율',
  EXISTING_SHARES: '기존 주식수',
  DILUTION_RATE: '희석률',
  // 사채(CB/BW)
  BOND_ISSUANCE_AMOUNT: '사채 발행총액',
  CB_CONVERSION_PRICE: '전환가액',
  BOND_INTEREST_RATE: '표면이자율',
  BOND_MATURITY_DATE: '만기일',
  BOND_TYPE: '사채 종류',
  // 최대주주 변경
  NEW_LARGEST_SHAREHOLDER: '신규 최대주주',
  PREVIOUS_LARGEST_SHAREHOLDER: '기존 최대주주',
  LARGEST_SHAREHOLDER_RATIO: '최대주주 지분율',
  SHAREHOLDER_CHANGE_REASON: '변경 사유',
  SHAREHOLDER_CHANGE_DATE: '변경일',
  // 실적
  REVENUE: '매출액',
  OPERATING_PROFIT: '영업이익',
  NET_PROFIT: '당기순이익',
  PREVIOUS_OPERATING_PROFIT: '전기 영업이익',
  OPERATING_PROFIT_YOY: '영업이익 증감률',
  // 소송
  LAWSUIT_AMOUNT: '소송 금액',
  CLAIM_CAUSE: '청구 원인',
  PLAINTIFF: '원고',
  DEFENDANT: '피고',
  LITIGATION_STAGE: '소송 단계',
  // 감사의견·거래정지·상폐·계약해제
  AUDIT_OPINION_TYPE: '감사의견',
  AUDIT_OPINION_REASON: '감사의견 사유',
  SUSPENSION_REASON: '거래정지 사유',
  SUSPENSION_START_DATE: '거래정지 시작일',
  EXPECTED_RESUME_DATE: '거래재개 예정일',
  DELISTING_STAGE: '상장폐지 단계',
  DELISTING_REASON: '상장폐지 사유',
  CANCELLED_CONTRACT_AMOUNT: '해지 계약금액',
  ORIGINAL_CONTRACT_AMOUNT: '원 계약금액',
  CANCELLATION_REASON: '해지 사유',
};

/** 미등재 factKey는 라벨 매핑 시 키 자체를 가독형으로 변환(예: FOO_BAR → Foo bar). */
function humanizeKey(factKey: string): string {
  const lower = factKey.toLowerCase().replace(/_/g, ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function factLabel(factKey: string): string {
  return FACT_LABEL[factKey] ?? humanizeKey(factKey);
}

function formatKrwCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_0000_0000)
    return `${(value / 1_0000_0000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억원`;
  if (abs >= 1_0000)
    return `${(value / 1_0000).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}만원`;
  return `${value.toLocaleString('ko-KR')}원`;
}

function formatDate(raw: string): string {
  const s = raw.trim();
  const m = /^(\d{4})[-.]?(\d{2})[-.]?(\d{2})$/.exec(s);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : s;
}

/**
 * fact 1건을 화면 표시 문자열로 포맷한다.
 *  - unit이 '원'이면 금액 압축, 'ratio'면 % 표기, '주'면 주식수 표기.
 *  - 숫자형이 아니거나 numericValue 결측이면 value(원시 문자열) 사용(날짜 포맷 적용).
 */
export function formatFiledFactValue(fact: FiledFact): string {
  const { numericValue, unit, value, period } = fact;
  const hasNumeric = typeof numericValue === 'number' && Number.isFinite(numericValue);

  if (hasNumeric) {
    const n = numericValue as number;
    if (unit === '원') return formatKrwCompact(n);
    if (unit === '주') return `${n.toLocaleString('ko-KR')}주`;
    if (unit === 'ratio' || unit === '%')
      return `${n.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}%`;
    if (unit && unit !== 'ratio') return `${n.toLocaleString('ko-KR')}${unit}`;
    return n.toLocaleString('ko-KR');
  }

  // 날짜형(period 동봉) 또는 텍스트형
  const raw = (period ?? value ?? '').trim();
  if (period) return formatDate(raw);
  return raw;
}
