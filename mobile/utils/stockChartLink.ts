import { router } from 'expo-router';

// DAR-363: 실시간 차트(app/stock/[stockCode]) 진입의 SSOT.
// 손익·신호가 보이는 모든 화면에서 동일한 가드/라우트로 1탭 진입을 보장한다.
// /stock 화면은 6자리 종목코드(ticker)를 stockCode 로 받는다 — corpCode(8자리)로는 시세를 못 받으므로
// 6자리 ticker 가 있을 때만 진입점을 노출한다(없으면 graceful 미표시).

/** /stock 화면이 시세·분봉을 조회할 수 있는 6자리 종목코드인지 판정. */
export function isChartableTicker(ticker?: string | null): ticker is string {
  return typeof ticker === 'string' && /^\d{6}$/.test(ticker);
}

/** 실시간 차트 화면으로 이동. 차트 불가 ticker 면 no-op(호출부 가드와 belt-and-suspenders). */
export function navigateToStockChart(ticker?: string | null): void {
  if (!isChartableTicker(ticker)) return;
  router.push(`/stock/${ticker}`);
}
