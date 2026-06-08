/**
 * dedupe.ts — 동일 키 중복 제거 순수 유틸 (DAR-122)
 *
 * 데이터 레벨 중복(중복 TradingSignal/Position 행)은 백엔드 디듑·DB 부분 유니크 인덱스로
 * 근절하지만, 화면은 마지막 보조 방어선으로 종목당 1카드만 노출한다. 첫 등장 항목을
 * 대표로 채택(입력 순서 보존) → 점수/최신순으로 정렬된 목록이면 자연히 최선 1건이 남는다.
 */

/** keyOf가 같은 항목은 첫 등장만 남긴다(순서 보존, 순수 함수). */
export function dedupeBy<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

/**
 * 종목(ticker/stockCode 우선, 없으면 corpCode) 단위 디듑.
 * 둘 다 비면 fallbackId로 폴백해 데이터 손실을 막는다(절대 행을 삼키지 않음).
 */
export function dedupeByStock<
  T extends {
    ticker?: string | null;
    stockCode?: string | null;
    corpCode?: string | null;
  },
>(items: readonly T[], fallbackId: (item: T) => string): T[] {
  return dedupeBy(
    items,
    (item) =>
      item.ticker || item.stockCode || item.corpCode || fallbackId(item),
  );
}
