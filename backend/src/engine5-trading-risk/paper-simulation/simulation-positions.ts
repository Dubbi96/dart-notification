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
 * 보유 포지션 표시 디듑(DAR-122) — 종목(stockCode)당 1행.
 *
 * 과거 중복 생성된 OPEN Position이 정리(cleanup 마이그레이션) 전이거나 다른 경로로
 * 동일 종목 다중 행이 남아 있어도, 화면에는 종목당 1카드만 노출한다(표시 보조 방어선).
 * 같은 종목은 평가금액(currentValue, null=진입가×수량)이 큰 행을 대표로 채택.
 * stockCode가 빈 값이면 corpCode를 키로 폴백. 입력 순서와 무관(결정론적).
 */
export function dedupeOpenPositionRows<T extends SimOpenPositionRow>(
  rows: readonly T[],
): T[] {
  const effectiveValue = (r: SimOpenPositionRow): number =>
    r.currentValue ?? r.entryPrice * r.quantity;
  const best = new Map<string, T>();
  for (const r of rows) {
    const key = r.stockCode || r.corpCode;
    const prev = best.get(key);
    if (!prev || effectiveValue(r) > effectiveValue(prev)) {
      best.set(key, r);
    }
  }
  return [...best.values()].sort(
    (a, b) => effectiveValue(b) - effectiveValue(a),
  );
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
