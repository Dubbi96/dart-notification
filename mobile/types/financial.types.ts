// 재무지표 스냅샷 (DAR-96) — GET /financials/latest 응답 data.
// 백엔드 FinancialSnapshot(financial-query.service.ts)과 1:1 대응한다.
// BigInt 금액은 number(원)로 직렬화되어 내려온다. 성장률(%)은 DAR-93 시계열 결과.

export interface FinancialSnapshot {
  corpCode: string;
  stockCode: string | null;
  /** 사업연도 (예: '2025') */
  bsnsYear: string;
  /** 보고서코드 11011(연간)/11012(반기)/11013(1Q)/11014(3Q) */
  reprtCode: string;
  /** 연결구분 CFS(연결) | OFS(별도) */
  fsDiv: string;
  revenue: number | null;
  operatingProfit: number | null;
  netIncome: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  totalEquity: number | null;
  eps: number | null;
  bps: number | null;
  roe: number | null;
  roa: number | null;
  debtRatio: number | null;
  per: number | null;
  pbr: number | null;
  // ── 다년 시계열 성장률(%) — DAR-93. 직전 기간 결측 시 null ──
  revenueGrowthYoY: number | null;
  operatingProfitGrowthYoY: number | null;
  epsGrowthYoY: number | null;
  revenueGrowthQoQ: number | null;
  operatingProfitGrowthQoQ: number | null;
  epsGrowthQoQ: number | null;
}
