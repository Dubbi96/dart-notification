// 내부자/대량보유 지분변동 (DAR-88) — GET /insider-holdings 응답 항목.

export type InsiderHoldingSource = 'MAJOR_STOCK' | 'EXECUTIVE';
export type InsiderTradeType = 'BUY' | 'SELL' | 'MIXED' | 'UNKNOWN';

export interface InsiderHoldingChange {
  id: string;
  source: InsiderHoldingSource;
  rcptNo: string;
  corpCode: string;
  /** 보고자명 */
  reporter: string;
  /** 관계/직위 (등기임원·주요주주·5%보유자 등) */
  relation: string | null;
  isExecutive: boolean | null;
  isRegistered: boolean | null;
  isMajorShareholder: boolean | null;
  /** 보유 주식수 — 보고 후 */
  sharesAfter: number | null;
  /** 증감 수 (+취득 / -처분) */
  sharesChange: number | null;
  /** 보유 비율 % — 보고 후 */
  ratioAfter: number | null;
  /** 비율 증감 %p */
  ratioChange: number | null;
  tradeType: InsiderTradeType;
  unitPrice: number | null;
  reportReason: string | null;
  /** 접수일(ISO) */
  reportedAt: string | null;
}

export interface InsiderHoldingsQuery {
  corpCode?: string;
  tradeType?: InsiderTradeType;
  source?: InsiderHoldingSource;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}
