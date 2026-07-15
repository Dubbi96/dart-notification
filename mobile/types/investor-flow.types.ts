/**
 * 수급(투자자별 매매동향)·공매도 타입 — 백엔드 InvestorFlowQueryService 응답과 1:1 (갭분석 W16).
 * GET /market-data/investor-flow · GET /market-data/short-selling (게스트 열람 가능).
 */

/** 투자자별 매매동향 1행(일별). 금액은 원 단위, 음수=순매도. */
export interface InvestorFlowRow {
  tradeDate: string; // YYYYMMDD
  foreignNetBuyQty: number;
  foreignNetBuyAmount: number;
  institutionNetBuyQty: number;
  institutionNetBuyAmount: number;
  individualNetBuyQty: number;
  individualNetBuyAmount: number;
  source: string; // 'KIS' | 'KRX'
}

/** 외국인·기관 누적 순매수 요약(최근 5/20거래일, 원). window*dDays 는 실제 반영 일수(부분 축적 정직 고지). */
export interface InvestorFlowSummary {
  foreignNet5dAmount: number;
  foreignNet20dAmount: number;
  institutionNet5dAmount: number;
  institutionNet20dAmount: number;
  window5dDays: number;
  window20dDays: number;
}

export interface InvestorFlowResult {
  stockCode: string;
  /** 데이터 기준일(최신 적재 거래일 YYYYMMDD). null 이면 데이터 없음 — 카드 억제. */
  asOfDate: string | null;
  rows: InvestorFlowRow[];
  summary: InvestorFlowSummary | null;
}

/** 공매도 일별 1행. 잔고 필드는 무료 소스 미가용 시 null(합성 금지 — 정직). */
export interface ShortSellingRow {
  tradeDate: string; // YYYYMMDD
  shortSellingVolume: number;
  shortSellingAmount: number | null;
  shortBalanceQty: number | null;
  shortBalanceRatio: number | null; // 잔고비율(%) — 현재 소스 미가용(null)
  shortVolumeRatio: number | null; // 거래비중(% — 당일 총거래량 대비)
  publishedDate: string; // 공표일(T+2 영업일) — as-of 소비 기준
  source: string;
}

export interface ShortSellingResult {
  stockCode: string;
  /** 데이터 기준일(최신 적재 거래일 YYYYMMDD). null 이면 데이터 없음. */
  asOfDate: string | null;
  rows: ShortSellingRow[];
}
