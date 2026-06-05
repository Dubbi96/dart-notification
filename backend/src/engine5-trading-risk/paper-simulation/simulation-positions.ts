/**
 * 모의운용 보유 포지션 모바일 표시 매퍼 — 순수 함수 (M10 모의운용, DAR-42)
 *
 * getSimulationStatus 응답의 openPositions[] 항목(종목·수량·평가손익)을 만든다.
 * Position row 의 nullable 시가평가 필드를 안전 기본값으로 정규화하고, corpName 을
 * 회사 조회 맵에서 보강한다.
 *
 * ★ 순수 산술/매핑만 — AI·체결·점수 개입 0. 실주문 경로 무관.
 */

/** Prisma Position row 중 모바일 표시에 필요한 부분 (시가평가 필드는 nullable) */
export interface SimOpenPositionRow {
  corpCode: string;
  stockCode: string;
  quantity: number;
  entryPrice: number;
  currentPrice: number | null;
  currentValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPct: number | null;
}

/** 모바일 포트폴리오 화면 보유 포지션 1행 */
export interface SimPositionDetail {
  corpCode: string;
  stockCode: string;
  /** 회사명(없으면 null — 종목코드로 대체 표시) */
  corpName: string | null;
  quantity: number;
  entryPrice: number;
  /** 최근 시가평가가(없으면 진입가) */
  currentPrice: number;
  /** 평가금액(없으면 진입가×수량) */
  currentValue: number;
  /** 평가손익(원) */
  unrealizedPnl: number;
  /** 평가손익률(%) */
  unrealizedPnlPct: number;
}

/**
 * Position row → 표시용 포지션. 아직 일일 스냅샷 전이라 시가평가 필드가 null 이면
 * 진입가 기준으로 보수적으로 채운다(손익 0).
 */
export function toSimPositionDetail(
  row: SimOpenPositionRow,
  corpNameByCode: Record<string, string>,
): SimPositionDetail {
  const currentPrice = row.currentPrice ?? row.entryPrice;
  const currentValue = row.currentValue ?? row.entryPrice * row.quantity;
  return {
    corpCode: row.corpCode,
    stockCode: row.stockCode,
    corpName: corpNameByCode[row.corpCode] ?? null,
    quantity: row.quantity,
    entryPrice: row.entryPrice,
    currentPrice,
    currentValue,
    unrealizedPnl: row.unrealizedPnl ?? 0,
    unrealizedPnlPct: row.unrealizedPnlPct ?? 0,
  };
}
