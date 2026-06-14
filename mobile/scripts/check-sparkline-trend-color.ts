/**
 * DAR-256 결정론적 검증: 스파크라인 색 = 5일 추세(첫→마지막) 부호.
 *
 * 버그: StockPriceBadge 가 미니 스파크라인(최근 5일 종가 라인)에 당일 등락률
 * 부호로 산정한 색(changeColor=pnlColor(changePercent))을 입혔다. '오늘 +0.3%·
 * 5일 추세 하락' 종목이면 우하향 라인이 상승색(success)으로 칠해져 파일 헤더의
 * '색=의미' 정직계약(스파크라인=추세, 색=당일)이 충돌했다.
 *
 * 해결: 스파크라인 색을 sparklineTrendColor(values)=returnColor(last-first) 로
 * 산정해 라인 기울기와 색을 일치시키고, 당일 부호 색은 % 텍스트 칩에만 남긴다.
 * 추세 방향은 sparklineTrendLabel 로 낭독(접근성)에도 병행 노출한다.
 *
 * 실행: npx tsx scripts/check-sparkline-trend-color.ts  (실패 시 exit 1)
 */
import './_setupDevGlobal.ts'; // 부작용: 전역 __DEV__ 주입(아래 import 보다 먼저)
import { pnlColor, sparklineTrendColor, sparklineTrendLabel } from '../utils/signalDisplay.ts';

import type { ThemeColors } from '../theme/index.ts';

// 검증용 토큰 — 실제 색상값은 무관하므로 식별 가능한 문자열만 주입.
const colors = {
  success: 'SUCCESS',
  error: 'ERROR',
  textSecondary: 'NEUTRAL',
} as unknown as ThemeColors;

let failed = 0;
function check(label: string, got: unknown, want: unknown): void {
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label} | got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
}

// 1) 색 산정 진리표 — 기울기와 색 일치
check('상승 추세(첫<마지막) → success', sparklineTrendColor([100, 110], colors), 'SUCCESS');
check('하락 추세(첫>마지막) → error', sparklineTrendColor([110, 100], colors), 'ERROR');
check('양끝 동일(횡보) → neutral', sparklineTrendColor([100, 105, 100], colors), 'NEUTRAL');
check('중간 등락 무시·양끝만(상승)', sparklineTrendColor([100, 80, 130], colors), 'SUCCESS');
check('중간 등락 무시·양끝만(하락)', sparklineTrendColor([100, 130, 90], colors), 'ERROR');
check('점 1개 → neutral(추세 없음)', sparklineTrendColor([100], colors), 'NEUTRAL');
check('점 0개 → neutral(추세 없음)', sparklineTrendColor([], colors), 'NEUTRAL');

// 2) DoD 핵심: '오늘 +/5일 -' 모순 케이스 — 라인 색은 하락(error), 당일 칩 색은 상승(success)
//    버그 시절엔 둘 다 success(pnlColor)였다. 이제 서로 다른 지표라 색이 갈린다.
const fiveDayDown = [105, 104, 103, 102, 100]; // 5일 하락
const todayUpPct = 0.3; // 오늘 +0.3%
const lineColor = sparklineTrendColor(fiveDayDown, colors);
const chipColor = pnlColor(todayUpPct, colors);
check('모순케이스 라인색=하락(error)', lineColor, 'ERROR');
check('모순케이스 칩색=당일상승(success)', chipColor, 'SUCCESS');
check('모순케이스 라인색≠칩색(분리 입증)', lineColor !== chipColor, true);

// 3) 반대 모순: '오늘 -/5일 +' — 라인 상승(success), 칩 하락(error)
const fiveDayUp = [100, 101, 103, 104, 110];
check('역모순 라인색=상승(success)', sparklineTrendColor(fiveDayUp, colors), 'SUCCESS');
check('역모순 칩색=당일하락(error)', pnlColor(-0.5, colors), 'ERROR');

// 4) 추세 레이블(접근성 병행) — 색 단독 금지 규칙 충족
check('레이블 상승', sparklineTrendLabel([100, 110]), '상승');
check('레이블 하락', sparklineTrendLabel([110, 100]), '하락');
check('레이블 횡보', sparklineTrendLabel([100, 100]), '횡보');
check('레이블 점부족 → 빈문자열', sparklineTrendLabel([100]), '');

// 5) 일관성: 라인 색과 추세 레이블이 같은 부호를 가리킨다
check('하락케이스 레이블=하락', sparklineTrendLabel(fiveDayDown), '하락');
check('상승케이스 레이블=상승', sparklineTrendLabel(fiveDayUp), '상승');

if (failed > 0) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed.');
