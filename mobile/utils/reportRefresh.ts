// DAR-210: 성과 리포트(L3) 탭별 pull-to-refresh 의존쿼리 매핑(순수).
//
// 문제: 화면은 useTradeHistory 만 refetch 했는데, '신호 정밀도'/'보정 권고' 탭의
//   SignalAccuracySection·CalibrationSection·UrgentCalibrationBanner·DataLimitBadge 는
//   각자 독립 useQuery(useSignalAccuracy/useCalibration/useSimulationEquityCurve)라
//   그 탭에서 당겨도 갱신되지 않아 stale 데이터를 최신으로 오인.
//
// 해결: 활성 탭이 실제로 화면에 그리는 쿼리들을 함께 refetch 한다. 헤더(요약 1행·시급
//   보정 배너)는 모든 탭에 상시 노출되므로 base(trade-history·equity-curve·calibration)는
//   항상 포함하고, '신호 정밀도' 탭에서만 signal-accuracy 를 추가한다.
//
// 이 파일은 탭→쿼리키 매핑만 담는 순수 함수로, 화면 의존 없이 결정론적으로 검증 가능하다.

export type ReportTab = 'performance' | 'precision' | 'calibration';

/** react-query QueryKey 와 구조 호환(readonly unknown[]). 의존성 없이 로컬 정의해 순수 검증. */
export type ReportRefreshKey = readonly string[];

// 헤더(SummaryRow·UrgentCalibrationBanner)는 모든 탭 상시 노출 → 항상 refetch.
//  - ['simulation','trade-history'] : 요약 수익률·매매 성적표(useTradeHistory)
//  - ['simulation','equity-curve']  : 추이 스파크라인(useSimulationEquityCurve)
//  - ['calibration']                : 가장 시급한 보정 권고 배너(useCalibration)
export const REPORT_REFRESH_KEYS_BASE: readonly ReportRefreshKey[] = [
  ['simulation', 'trade-history'],
  ['simulation', 'equity-curve'],
  ['calibration'],
];

// '신호 정밀도' 탭에서만 그려지는 쿼리(DataLimitBadge·SignalAccuracySection = useSignalAccuracy).
export const PRECISION_ONLY_KEY: ReportRefreshKey = ['backtest', 'signal-accuracy'];

/**
 * 활성 탭에서 당겨 새로고침할 때 refetch 해야 하는 쿼리키 목록(중복 없음).
 * base(상시 헤더) + 탭 전용. 키 순서는 결정론적(검증 안정).
 */
export function refreshKeysForReportTab(tab: ReportTab): ReportRefreshKey[] {
  const keys: ReportRefreshKey[] = [...REPORT_REFRESH_KEYS_BASE];
  if (tab === 'precision') keys.push(PRECISION_ONLY_KEY);
  return keys;
}
