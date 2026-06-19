/**
 * 시장지수 연속성 sanity 가드 (DAR-367).
 *
 * 배경: 홈 배지에 KOSPI `-63.75%`(close 3132 vs prevClose 8639)라는 물리적으로 불가능한
 * 수치가 검증 없이 노출됐다. 근본 원인은 `kospi_dd_trd` 응답의 여러 지수 시리즈(종합·200·
 * 업종지수 등)를 모두 동일 indexCode 로 적재하다 마지막 행이 종합지수를 덮어쓴 것이었다
 * (krx-api.service `fetchIndexDaily` 에서 종합지수 행만 선별하도록 정정).
 *
 * 이 모듈은 그 정정을 보강하는 **연속성 방어선**이다. 인접 거래일 종가 대비 변동률이
 * 임계를 넘으면 적재 단계(scheduler)에서 격리하고, 혹시 과거에 오염된 행이 남아 있어도
 * 표시 단계(service.fetchLatestIndices)에서 사용자에게 노출하지 않는다.
 */

/**
 * 인접 거래일 종가지수 변동률 허용 상한(%). 한국 지수에 일중 ±20%는 사이드카·서킷브레이커가
 * 발동하는 극단값으로, 인접일 |Δ| 가 이를 초과하면 데이터 오염으로 간주한다.
 * (참고: 2020-03 코로나 폭락 당시 KOSPI 일간 최대 낙폭도 -8.4% 수준.)
 */
export const MAX_INDEX_DAILY_CHANGE_PCT = 20;

/**
 * 인접 거래일 종가 대비 변동률이 물리적으로 불가능한 수준(임계 초과)인지 판정한다.
 * - prevClose 가 null·0·음수면 비교 기준이 없으므로 이상치로 보지 않는다(false).
 * - 순수 함수: 적재(거부)·표시(폴백) 양쪽에서 동일 기준을 공유한다.
 */
export function isImplausibleIndexChange(
  closeIndex: number,
  prevCloseIndex: number | null,
  threshold: number = MAX_INDEX_DAILY_CHANGE_PCT,
): boolean {
  if (prevCloseIndex === null || prevCloseIndex <= 0) return false;
  const changePct = Math.abs((closeIndex - prevCloseIndex) / prevCloseIndex) * 100;
  return changePct > threshold;
}
