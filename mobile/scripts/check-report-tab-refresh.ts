/**
 * DAR-210 결정론적 검증: 성과 리포트 탭별 pull-to-refresh 의존쿼리 매핑.
 *
 * 버그(수정 전): 화면 onRefresh = useTradeHistory.refetch 만 호출 → '신호 정밀도'/'보정 권고'
 *   탭의 독립 쿼리(signal-accuracy/calibration/equity-curve)는 그 탭에서 당겨도 미갱신(stale).
 * 해결(수정 후): 활성 탭이 실제로 그리는 쿼리키를 refreshKeysForReportTab 로 매핑해 일괄 refetch.
 *
 * 이 스크립트는 그 순수 매핑을 검증한다. 각 탭에서 당기면 그 탭의 의존 쿼리가 빠짐없이,
 * 또한 무관한 쿼리는 포함하지 않고 refetch 대상에 들어가는지(DoD: 그 탭 의존쿼리 실제 refetch).
 *
 * 실행: npx tsx scripts/check-report-tab-refresh.ts  (실패 시 exit 1)
 */
import {
  refreshKeysForReportTab,
  REPORT_REFRESH_KEYS_BASE,
  PRECISION_ONLY_KEY,
} from '../utils/reportRefresh.ts';

import type { ReportTab, ReportRefreshKey } from '../utils/reportRefresh.ts';

const TRADE_HISTORY: ReportRefreshKey = ['simulation', 'trade-history'];
const EQUITY_CURVE: ReportRefreshKey = ['simulation', 'equity-curve'];
const CALIBRATION: ReportRefreshKey = ['calibration'];
const SIGNAL_ACCURACY: ReportRefreshKey = ['backtest', 'signal-accuracy'];

const k = (key: ReportRefreshKey): string => key.join('|');

function has(keys: ReportRefreshKey[], target: ReportRefreshKey): boolean {
  return keys.some((key) => k(key) === k(target));
}

interface Scenario {
  name: string;
  tab: ReportTab;
  /** 반드시 포함되어야 하는 쿼리키(그 탭이 화면에 그리는 것) */
  required: ReportRefreshKey[];
  /** 절대 포함되면 안 되는 쿼리키(그 탭에 없는 것) */
  forbidden: ReportRefreshKey[];
}

// 헤더(요약 1행·시급 보정 배너)는 모든 탭 상시 노출 → 모든 탭에서 base 3종 필수.
const scenarios: Scenario[] = [
  {
    name: '성과 탭 — 매매내역·요약·추이·시급보정(헤더) refetch, 정밀도 쿼리는 제외',
    tab: 'performance',
    required: [TRADE_HISTORY, EQUITY_CURVE, CALIBRATION],
    forbidden: [SIGNAL_ACCURACY],
  },
  {
    name: '신호 정밀도 탭 — signal-accuracy 포함(이 탭의 핵심 독립쿼리) + 헤더 base',
    tab: 'precision',
    required: [TRADE_HISTORY, EQUITY_CURVE, CALIBRATION, SIGNAL_ACCURACY],
    forbidden: [],
  },
  {
    name: '보정 권고 탭 — calibration 포함 + 헤더 base, 정밀도 쿼리는 제외',
    tab: 'calibration',
    required: [TRADE_HISTORY, EQUITY_CURVE, CALIBRATION],
    forbidden: [SIGNAL_ACCURACY],
  },
];

let failures = 0;
function check(cond: boolean, label: string): void {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${label}`);
}

for (const sc of scenarios) {
  const keys = refreshKeysForReportTab(sc.tab);
  for (const r of sc.required) {
    check(has(keys, r), `${sc.name}\n   필수 포함: ${k(r)}`);
  }
  for (const f of sc.forbidden) {
    check(!has(keys, f), `${sc.name}\n   제외 확인: ${k(f)}`);
  }
  // 중복 키 없음(같은 쿼리를 두 번 refetch 하지 않음)
  const uniq = new Set(keys.map(k));
  check(uniq.size === keys.length, `${sc.name}\n   중복 키 없음 (${keys.length}건)`);
}

// base 상수가 정확히 헤더 3종인지(상시 노출 보장)
check(REPORT_REFRESH_KEYS_BASE.length === 3, 'base 키 3종 (trade-history·equity-curve·calibration)');
check(has([...REPORT_REFRESH_KEYS_BASE], CALIBRATION), 'base 에 calibration 포함(시급 보정 배너 상시)');
check(k(PRECISION_ONLY_KEY) === k(SIGNAL_ACCURACY), 'precision 전용 키 = signal-accuracy');

// 회귀 핵심: 수정 전엔 trade-history 만 갱신됐다 → 이제 정밀도/보정 탭서 누락 0 임을 못박는다.
check(
  has(refreshKeysForReportTab('precision'), SIGNAL_ACCURACY) &&
    has(refreshKeysForReportTab('calibration'), CALIBRATION) &&
    has(refreshKeysForReportTab('precision'), EQUITY_CURVE),
  '회귀 가드: 정밀도/보정 탭의 독립쿼리가 더 이상 stale 로 누락되지 않음',
);

console.log(`\n결과: ${failures === 0 ? 'ALL PASS' : `${failures} FAIL`}`);
if (failures > 0) {
  console.error('FAILURES present');
  process.exit(1);
}
