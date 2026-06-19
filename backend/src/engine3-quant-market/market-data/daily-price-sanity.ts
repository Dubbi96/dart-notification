/**
 * 일봉 OHLC 품질 가드 (DAR-376).
 *
 * EventStudy(공시→D+N 초과수익)의 backbone 인 StockDailyPrice 에 손상된 행이 섞이면 인과분석이
 * 오염된다. KRX 원행을 적재하기 전 행 단위로 물리적 정합성을 검사한다(전일 대비 비교가 아니라
 * 단일 행 내 OHLC 일관성·양수성만 — 전종목×전거래일 bulk 경로에서 전일 조회 없이 O(1) 검사).
 *
 * 거부 조건(하나라도 해당하면 손상으로 보고 적재 제외):
 *   - 시/고/저/종가 중 0 이하(음수·0) — 거래정지·데이터 누락 잔재.
 *   - 고가 < 저가 — 물리적으로 불가능.
 *   - 종가 또는 시가가 [저가, 고가] 범위 밖 — KRX 파싱/소스 오류.
 *
 * ※ 전일대비 ±상한 이상치(DAR-367 지수 sanity 의 시계열 가드)는 종목별 직전 종가 조회가 필요해
 *   bulk 적재 경로에 부적합하므로 여기서는 다루지 않는다(행 내 정합성만). 시계열 이상치 격리는
 *   향후 별도 배치로 분리.
 */
export interface DailyOhlc {
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
}

/** 행 내 OHLC 가 물리적으로 정합한가(양수·고≥저·시·종이 [저,고] 내). */
export function isValidDailyOhlc(row: DailyOhlc): boolean {
  const { openPrice, highPrice, lowPrice, closePrice } = row;
  if (
    !(openPrice > 0) ||
    !(highPrice > 0) ||
    !(lowPrice > 0) ||
    !(closePrice > 0)
  ) {
    return false;
  }
  if (highPrice < lowPrice) return false;
  if (closePrice < lowPrice || closePrice > highPrice) return false;
  if (openPrice < lowPrice || openPrice > highPrice) return false;
  return true;
}
