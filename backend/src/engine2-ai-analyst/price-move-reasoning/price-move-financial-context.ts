/**
 * DAR-528 (Wave C/C3·P1) — '왜 움직였나' 카드 재무 맥락 한 줄(규칙 기반·AI 무접점).
 *
 * 역방향 리즈닝(설명층) 결과에 재무 맥락 한 줄을 덧붙인다:
 *   "이번 계약 규모는 2025 연매출의 약 12.3% (1,230억 / 연매출 1조)"
 *
 * ★정직 원칙(수용기준 1): 분자(공시 규모)·분모(연매출) 중 하나라도 결측/불확실이면 null →
 *   FE 는 표시를 생략한다. 수치 발명·추정 금지.
 * ★AI 무접점(수용기준 2): 순수 함수 — LLM 호출·비용게이트·AIUsageLog 무영향(AI 비용 증가 0).
 * ★분모 불확실 처리: 분기/반기 보고서의 매출은 누적 부분치라 '연매출' 분모로 불확실 →
 *   연간 보고서(reprtCode=11011)의 매출만 분모로 인정한다(그 외엔 null).
 */

/** 연간 사업보고서 코드 — '연매출' 분모로 인정하는 유일한 출처(분기/반기 누적치 배제). */
export const ANNUAL_REPRT_CODE = '11011';

/** 인과 공시에서 뽑은 규모(분자). */
export interface EventScale {
  /** 표시용 규모 라벨(예: '계약 규모'). */
  label: string;
  /** 규모 금액(원). 양수만 유효. */
  amountWon: number;
}

export interface FinancialContextInput {
  /** 인과 공시 이벤트 유형(DisclosureEvent.eventType). */
  eventType: string;
  /** 인과 공시 이벤트의 추출 수치 JSON(DisclosureEvent.extractedData) — 형상은 유형별. */
  extractedData: unknown;
  /** 최신 연간(11011) 매출액(원, 분모). 결측/≤0 이면 null → 표시 생략(분모 불확실). */
  annualRevenueWon: number | null;
  /** 분모 재무의 사업연도(표시용, 예: '2025'). */
  annualRevenueYear: string | null;
}

/**
 * 인과 공시 이벤트 유형·추출데이터에서 '규모(분자)'를 회수한다.
 * 신뢰 가능한 금액 필드가 있는 유형만 노출한다(그 외 null → 재무 맥락 생략, 수치 발명 금지).
 * 현재: SUPPLY_CONTRACT(단일판매·공급계약) contractAmount. 확장 시 이 맵에 유형을 추가한다.
 */
export function resolveEventScale(eventType: string, extractedData: unknown): EventScale | null {
  const data = asRecord(extractedData);
  if (!data) return null;

  switch (eventType) {
    case 'SUPPLY_CONTRACT': {
      const amount = coercePositiveAmount(data.contractAmount);
      return amount === null ? null : { label: '계약 규모', amountWon: amount };
    }
    default:
      // 금액 형상이 검증되지 않은 유형은 정직하게 생략(허위 분자 방지).
      return null;
  }
}

/**
 * '왜 움직였나' 카드 재무 맥락 한 줄을 산출한다. 산출 불가(분자/분모 결측·불확실)면 null.
 * @returns 표시 문자열 또는 null(표시 생략).
 */
export function buildFinancialContext(input: FinancialContextInput): string | null {
  const scale = resolveEventScale(input.eventType, input.extractedData);
  if (!scale) return null; // 분자 결측 → 생략

  const denom = input.annualRevenueWon;
  // ★분모 불확실/결측 → null(수용기준 핵심). 0·음수·비유한수도 분모로 부적격.
  if (denom === null || !Number.isFinite(denom) || denom <= 0) return null;

  const pct = (scale.amountWon / denom) * 100;
  if (!Number.isFinite(pct)) return null;

  const pctLabel = pct < 0.1 ? '0.1% 미만' : `약 ${round1(pct)}%`;
  const yearPrefix = input.annualRevenueYear ? `${input.annualRevenueYear} ` : '';
  return (
    `이번 ${scale.label}는 ${yearPrefix}연매출의 ${pctLabel}` +
    ` (${formatKoreanAmount(scale.amountWon)} / 연매출 ${formatKoreanAmount(denom)})`
  );
}

// ─── 순수 유틸 ──────────────────────────────────────────────────────────────

/** unknown JSON 을 안전하게 레코드로 좁힌다(배열·원시값·null 은 제외). */
function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 값을 원(原) 단위 양수 금액으로 강제. 숫자/숫자문자열 허용. 0·음수·NaN·파싱불가 → null. */
function coercePositiveAmount(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string') {
    const n = Number(value.replace(/[,\s]/g, ''));
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * 금액(원)을 한국어 축약 표기로. 조/억 단위 우선, 미만은 만/원.
 * 표시 전용 — 반올림 표기이며 원값 정밀도를 주장하지 않는다.
 */
function formatKoreanAmount(won: number): string {
  const abs = Math.abs(won);
  const JO = 1_000_000_000_000;
  const EOK = 100_000_000;
  const MAN = 10_000;
  if (abs >= JO) {
    const jo = Math.floor(won / JO);
    const restEok = Math.round((won - jo * JO) / EOK);
    return restEok > 0 ? `${jo}조 ${restEok}억` : `${jo}조`;
  }
  if (abs >= EOK) return `${round1(won / EOK)}억`;
  if (abs >= MAN) return `${Math.round(won / MAN)}만`;
  return `${Math.round(won)}원`;
}
