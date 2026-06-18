/**
 * bucket-classifier.ts — 이벤트 버킷 분류 (M5-A, DAR-9)
 *
 * 공시 이벤트 타입과 추출 데이터를 기반으로 버킷 키를 생성한다.
 * 동일 이벤트 타입 내에서도 규모·특성에 따라 세분화된 버킷을 부여한다.
 */

export interface EventExtractedData {
  contractAmount?: number;      // 계약금액 (원)
  recentSalesAmount?: number;   // 최근 매출액 (원)
  isAmendment?: boolean;        // 정정공시 여부
  isCancellation?: boolean;     // 취소·해제 여부
  isLargeCorp?: boolean;        // 상대방이 상호출자제한기업집단
  isOverseas?: boolean;         // 해외 거래
  sharesRatio?: number;         // 취득 규모 / 시총 비율 (소수, 예: 0.02 = 2%)
  dilutionRatio?: number;       // 희석률 (소수)
  isRightsOffering?: boolean;   // 주주배정 여부
  amountRatio?: number;         // 발행금액/시총 비율 (소수)
  dividendChangeRatio?: number; // 전년 대비 변화율 (소수, 0.20 = 20%)
  allotmentType?: string;       // "THIRD_PARTY" | "RIGHTS_OFFERING" | "PUBLIC"
}

/**
 * 부모(coarse) 풀링 버킷의 특수 bucketKey (DAR-325).
 *
 * fine 버킷(`{EVENT_TYPE}__{suffix}`)이 영영 소표본일 때, 같은 (eventType, marketType)
 * 의 **원시 이벤트를 suffix 무시하고 합쳐** D±N 윈도우를 재계산한 부모 버킷을 이 키로
 * 나란히 영속한다. fine 키 형식(`__{suffix}`)과 충돌하지 않는 예약값.
 * 산출(event-study-calculation)과 조회(signal-generation resolveEventStudy)가 공유한다.
 */
export const COARSE_BUCKET_KEY = '__ALL__';

/**
 * 이벤트 타입과 추출 데이터를 기반으로 버킷 키를 반환한다.
 *
 * 버킷 키 형식: `{EVENT_TYPE}__{suffix}`
 */
export function classifyBucket(eventType: string, data: EventExtractedData): string {
  switch (eventType) {
    case 'SUPPLY_CONTRACT':
      return classifySupplyContract(data);

    case 'SHARE_BUYBACK':
      return classifyShareBuyback(data);

    case 'SHARE_CANCELLATION':
      return 'SHARE_CANCELLATION__all';

    case 'PAID_IN_CAPITAL_INCREASE':
      return classifyPaidInCapitalIncrease(data);

    case 'CB_ISSUANCE':
      return classifyCBIssuance(data);

    case 'BW_ISSUANCE':
      return 'BW_ISSUANCE__all';

    case 'DIVIDEND_INCREASE':
      return classifyDividendIncrease(data);

    case 'DIVIDEND_CUT':
      return 'DIVIDEND_CUT__all';

    default:
      return `${eventType}__default`;
  }
}

// ─── 개별 분류 함수 ──────────────────────────────────────────────

function classifySupplyContract(data: EventExtractedData): string {
  // 취소·해제 우선
  if (data.isCancellation) return 'SUPPLY_CONTRACT__cancellation';
  // 정정 공시
  if (data.isAmendment) return 'SUPPLY_CONTRACT__amendment';

  const { contractAmount, recentSalesAmount, isLargeCorp, isOverseas } = data;

  // 비율 계산
  if (contractAmount !== undefined && recentSalesAmount !== undefined && recentSalesAmount > 0) {
    const ratio = contractAmount / recentSalesAmount;

    if (isLargeCorp && ratio >= 0.20) {
      return 'SUPPLY_CONTRACT__ratio_gte20__large_corp';
    }
    if (ratio < 0.05) return 'SUPPLY_CONTRACT__ratio_lt5';
    if (ratio >= 0.05 && ratio < 0.20) return 'SUPPLY_CONTRACT__ratio_5to20';
    if (ratio >= 0.20) return 'SUPPLY_CONTRACT__ratio_gte20';
  }

  // 해외 거래
  if (isOverseas) return 'SUPPLY_CONTRACT__overseas';

  return 'SUPPLY_CONTRACT__unknown';
}

function classifyShareBuyback(data: EventExtractedData): string {
  const { sharesRatio } = data;
  if (sharesRatio === undefined) return 'SHARE_BUYBACK__ratio_lt1';
  if (sharesRatio < 0.01) return 'SHARE_BUYBACK__ratio_lt1';
  if (sharesRatio < 0.03) return 'SHARE_BUYBACK__ratio_1to3';
  return 'SHARE_BUYBACK__ratio_gte3';
}

function classifyPaidInCapitalIncrease(data: EventExtractedData): string {
  if (data.isRightsOffering) return 'PAID_IN_CAPITAL__rights_offering';
  const dilution = data.dilutionRatio ?? 0;
  if (dilution < 0.10) return 'PAID_IN_CAPITAL__third_party_lt10pct_dilution';
  return 'PAID_IN_CAPITAL__third_party_gte10pct_dilution';
}

function classifyCBIssuance(data: EventExtractedData): string {
  const ratio = data.amountRatio ?? 0;
  if (ratio < 0.05) return 'CB_ISSUANCE__ratio_lt5';
  return 'CB_ISSUANCE__ratio_gte5';
}

function classifyDividendIncrease(data: EventExtractedData): string {
  const changeRatio = data.dividendChangeRatio ?? 0;
  if (changeRatio >= 0.20) return 'DIVIDEND_INCREASE__gte20pct_yoy';
  return 'DIVIDEND_INCREASE__lt20pct_yoy';
}

/**
 * DisclosureEvent 한 건 → canonical bucketKey (DAR-133).
 *
 * Event Study 산출(집계)과 signal-generation 조회가 **동일한** 버킷 키를 쓰도록 하는
 * 단일 진입점. `isAmendment` 는 DisclosureEvent 의 별도 컬럼이므로 분류기에 넘기기 전
 * extractedData 에 병합한다(분류기는 EventExtractedData.isAmendment 를 읽음).
 *
 * extractedData 가 객체가 아니면(빈 JSON·배열·null) 빈 객체로 폴백 → default 버킷.
 */
export function deriveBucketKeyForEvent(
  eventType: string,
  extractedData: unknown,
  isAmendment: boolean,
): string {
  const ed =
    extractedData && typeof extractedData === 'object' && !Array.isArray(extractedData)
      ? (extractedData as Record<string, unknown>)
      : {};
  const data: EventExtractedData = {
    ...(ed as EventExtractedData),
    isAmendment,
  };
  return classifyBucket(eventType, data);
}
