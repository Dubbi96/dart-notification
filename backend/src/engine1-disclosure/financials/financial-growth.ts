/**
 * 재무 시계열 성장률 산출 — YoY/QoQ (DAR-93).
 *
 * 다년/분기 CompanyFinancial 시계열로부터 매출·영업이익·EPS 의 전년동기(YoY)·
 * 전기(QoQ) 성장률(%)을 산출하는 **순수 함수**. I/O·AI 미개입.
 *
 * 배경: financial-collection 이 reprtCode 11011~11014(사업·반기·1Q·3Q)를 다년 적재하지만
 * philosophy.scorer 의 EPS_GROWTH_YOY·REVENUE_GROWTH_YOY 는 직전 기간 데이터가 없어 결측이었다.
 * 본 유틸이 직전 기간을 찾아 성장률을 계산 → 영속·스코어러 연결로 결측을 복원한다.
 *
 * 성장률 정의: growth(%) = (현재 − 직전) / |직전| × 100.
 *  - 분모에 절대값을 써 적자→흑자 전환(예: EPS −100 → +50 = +150%)의 방향성을 보존한다.
 *  - 직전이 null 또는 0, 현재가 null 이면 산출 불가(null) — 결측 폴백.
 *  - 매출은 항상 양수라 절대값 영향 없음. EPS·영업이익만 부호 전환 케이스가 발생한다.
 */

/** 성장률 산출 입력 — 한 기간(연도×보고서)의 핵심 절대지표(원 단위 number). */
export interface PeriodFinancials {
  bsnsYear: string; // 사업연도 (예: '2024')
  reprtCode: string; // 보고서코드 11011/11012/11013/11014
  revenue: number | null;
  operatingProfit: number | null;
  eps: number | null;
}

/** 한 기간의 성장률 결과(%). 산출 불가 항목은 null. */
export interface GrowthRates {
  revenueGrowthYoY: number | null;
  operatingProfitGrowthYoY: number | null;
  epsGrowthYoY: number | null;
  revenueGrowthQoQ: number | null;
  operatingProfitGrowthQoQ: number | null;
  epsGrowthQoQ: number | null;
}

const EMPTY_GROWTH: GrowthRates = {
  revenueGrowthYoY: null,
  operatingProfitGrowthYoY: null,
  epsGrowthYoY: null,
  revenueGrowthQoQ: null,
  operatingProfitGrowthQoQ: null,
  epsGrowthQoQ: null,
};

/**
 * 성장률(%) = (현재 − 직전) / |직전| × 100, 소수 2자리.
 * 직전 null/0 또는 현재 null → null(산출 불가).
 */
export function calcGrowthRate(
  current: number | null,
  prior: number | null,
): number | null {
  if (current == null || prior == null || prior === 0) return null;
  if (!isFinite(current) || !isFinite(prior)) return null;
  const g = ((current - prior) / Math.abs(prior)) * 100;
  return Math.round(g * 100) / 100;
}

/**
 * 보고서코드 → 분기 인덱스(시계열 정렬용).
 * 1Q(11013) < 반기(11012) < 3Q(11014) < 사업보고서(11011). 미상은 마지막(99).
 */
export function quarterIndex(reprtCode: string): number {
  switch (reprtCode) {
    case '11013':
      return 1; // 1분기보고서
    case '11012':
      return 2; // 반기보고서
    case '11014':
      return 3; // 3분기보고서
    case '11011':
      return 4; // 사업보고서
    default:
      return 99;
  }
}

function periodKey(bsnsYear: string, reprtCode: string): string {
  return `${bsnsYear}:${reprtCode}`;
}

/**
 * 종목 1개의 기간 시계열 → 기간별 성장률 맵.
 *
 * - 키: `${bsnsYear}:${reprtCode}` (입력 행과 1:1 매칭).
 * - YoY: 동일 보고서코드(같은 회계 시점)·전년도(bsnsYear−1) 대비 — like-for-like 비교.
 * - QoQ: 시계열 정렬상 직전 기간(연도 asc, 분기 asc) 대비.
 *   DART 정기보고서는 누적치(반기=상반기 누적 등)라 QoQ 는 누적 기준 비교임을 유의한다.
 *
 * 직전 기간이 없으면 해당 성장률은 null(결측 폴백). 입력 순서·중복에 무관하게 결정론적.
 */
export function computeGrowthSeries(
  rows: PeriodFinancials[],
): Map<string, GrowthRates> {
  const result = new Map<string, GrowthRates>();
  if (rows.length === 0) return result;

  // 기간 키 → 행 (중복 시 마지막 우선; 정상 데이터는 자연키 유일)
  const byKey = new Map<string, PeriodFinancials>();
  for (const r of rows) {
    byKey.set(periodKey(r.bsnsYear, r.reprtCode), r);
  }

  // 시계열 정렬(연도 asc → 분기 asc) — QoQ 직전 기간 탐색용.
  const sorted = [...byKey.values()].sort((a, b) => {
    const ya = Number(a.bsnsYear);
    const yb = Number(b.bsnsYear);
    if (ya !== yb) return ya - yb;
    return quarterIndex(a.reprtCode) - quarterIndex(b.reprtCode);
  });

  for (let i = 0; i < sorted.length; i++) {
    const cur = sorted[i];

    // YoY: 같은 보고서코드·전년도
    const yoyPrior = byKey.get(
      periodKey(String(Number(cur.bsnsYear) - 1), cur.reprtCode),
    );
    // QoQ: 정렬상 직전 기간
    const qoqPrior = i > 0 ? sorted[i - 1] : undefined;

    result.set(periodKey(cur.bsnsYear, cur.reprtCode), {
      revenueGrowthYoY: yoyPrior
        ? calcGrowthRate(cur.revenue, yoyPrior.revenue)
        : null,
      operatingProfitGrowthYoY: yoyPrior
        ? calcGrowthRate(cur.operatingProfit, yoyPrior.operatingProfit)
        : null,
      epsGrowthYoY: yoyPrior ? calcGrowthRate(cur.eps, yoyPrior.eps) : null,
      revenueGrowthQoQ: qoqPrior
        ? calcGrowthRate(cur.revenue, qoqPrior.revenue)
        : null,
      operatingProfitGrowthQoQ: qoqPrior
        ? calcGrowthRate(cur.operatingProfit, qoqPrior.operatingProfit)
        : null,
      epsGrowthQoQ: qoqPrior ? calcGrowthRate(cur.eps, qoqPrior.eps) : null,
    });
  }

  return result;
}

export { EMPTY_GROWTH };
