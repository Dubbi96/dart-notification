/**
 * C9. 펀더멘털 점수 (FundamentalScore) — DAR-100
 *
 * 수집·정규화는 끝났으나 매수신호 입력으로 0건 반영되던 두 사장 자산을 활성화한다.
 *   - 재무 시계열 성장률(DAR-93 YoY): 매출·영업이익·EPS 전년동기 대비 성장 → 가점,
 *     역성장 → 감점(대칭 매핑).
 *   - 공시 본문 정량값(DAR-95 DartFiledFact): 계약금액/매출 규모 → 가점,
 *     CB·유상증자 본문 희석률 → 감점.
 *   - 결측(성장률·정량값 전무) → 0 안전 처리. bucket-renormalization 이 분모에서
 *     제외하여 기존 8버킷 가중치를 정확히 복원하므로 회귀 0(insider 선례와 동일).
 *
 * AI 금지영역: 순수 Rule 함수. AI/LLM 개입 절대 금지.
 */

/** DAR-93 CompanyFinancial 다년 시계열 성장률(%) — 결측 가능. */
export interface FundamentalGrowthInput {
  /** 매출 YoY 성장률(%) */
  revenueGrowthYoY: number | null;
  /** 영업이익 YoY 성장률(%) */
  operatingProfitGrowthYoY: number | null;
  /** EPS YoY 성장률(%) */
  epsGrowthYoY: number | null;
}

/** DAR-95 DartFiledFact 본문 정량값 — 결측 가능. */
export interface FundamentalFiledFactInput {
  /** 계약금액/매출 비율(%) — 본문 정량표 CONTRACT_TO_SALES_RATIO. */
  contractToSalesRatio: number | null;
  /** 희석률(%) — CB/유상증자 본문 DILUTION_RATE. */
  dilutionRate: number | null;
}

export interface FundamentalInput {
  /** 재무 성장률(DAR-93). 미주입/전필드 null 시 결측. */
  growth: FundamentalGrowthInput | null;
  /** 공시 본문 정량값(DAR-95). 미주입/전필드 null 시 결측. */
  filedFacts: FundamentalFiledFactInput | null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isNum(v: number | null | undefined): v is number {
  return typeof v === 'number' && isFinite(v);
}

/** 성장률(%) → 점수(-100..100). 양호한 성장 가점·역성장 감점(대칭 단조). */
function growthPoints(g: number): number {
  if (g >= 50) return 100;
  if (g >= 30) return 75;
  if (g >= 15) return 50;
  if (g >= 5) return 25;
  if (g >= 0) return 10;
  if (g >= -5) return -10;
  if (g >= -15) return -40;
  if (g >= -30) return -70;
  return -100;
}

/** 계약금액/매출 비율(%) → 점수(0..100). 본문 정량 규모 가점(감점 없음). */
function contractSizePoints(ratio: number): number {
  if (ratio >= 50) return 100;
  if (ratio >= 30) return 80;
  if (ratio >= 10) return 50;
  if (ratio >= 5) return 25;
  if (ratio >= 1) return 10;
  return 0;
}

/** 희석률(%) → 점수(-100..0). CB/유증 본문 희석 규모 감점(가점 없음). */
function dilutionPoints(rate: number): number {
  if (rate >= 30) return -100;
  if (rate >= 20) return -70;
  if (rate >= 10) return -40;
  if (rate >= 5) return -20;
  return 0;
}

/** 가용 신호(가중치, 점수) 쌍을 가중평균 — 결측 신호는 분모에서 제외. */
interface WeightedSignal {
  weight: number;
  score: number;
}

function collectSignals(input: FundamentalInput): WeightedSignal[] {
  const out: WeightedSignal[] = [];
  const g = input?.growth;
  if (g) {
    if (isNum(g.revenueGrowthYoY))
      out.push({ weight: 0.3, score: growthPoints(g.revenueGrowthYoY) });
    if (isNum(g.operatingProfitGrowthYoY))
      out.push({ weight: 0.3, score: growthPoints(g.operatingProfitGrowthYoY) });
    if (isNum(g.epsGrowthYoY))
      out.push({ weight: 0.15, score: growthPoints(g.epsGrowthYoY) });
  }
  const f = input?.filedFacts;
  if (f) {
    if (isNum(f.contractToSalesRatio))
      out.push({ weight: 0.15, score: contractSizePoints(f.contractToSalesRatio) });
    if (isNum(f.dilutionRate))
      out.push({ weight: 0.1, score: dilutionPoints(f.dilutionRate) });
  }
  return out;
}

/**
 * 펀더멘털 데이터 보유 여부. 성장률·본문 정량값 중 하나라도 유효 수치가 있으면 가용.
 * bucket-renormalization 의 결측 판별과 의미를 일치시킨다.
 */
export function hasFundamentalData(input: FundamentalInput | null | undefined): boolean {
  if (!input) return false;
  return collectSignals(input).length > 0;
}

/**
 * 가용 신호의 가중평균 점수(-100..100, 정수). 결측 신호는 분모에서 제외해 상대 비중 보존.
 * 전부 결측이면 0(중립) — 재정규화에서 버킷 자체가 제외된다.
 */
export function scoreFundamental(input: FundamentalInput): number {
  const signals = collectSignals(input);
  if (signals.length === 0) return 0;

  const weightSum = signals.reduce((s, sig) => s + sig.weight, 0);
  if (weightSum <= 0) return 0;
  const weighted = signals.reduce((s, sig) => s + sig.weight * sig.score, 0) / weightSum;

  return Math.round(clamp(weighted, -100, 100));
}
