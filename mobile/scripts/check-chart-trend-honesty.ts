/**
 * DAR-450 결정론적 검증: 자산곡선/스파크라인 추세색 정직성(C7) + 데이터점 44pt 히트영역(C4).
 *
 * 버그:
 *  C7) EquityCurveChart/PerformanceSparkline 가 추세선 색을 '마지막 점 부호'(pnlColor(last))로
 *      칠해, 하락 중이나 양(+)인 곡선이 초록이 되어 색=의미가 어긋났다. 이미 존재하는
 *      sparklineTrendColor/Label(기울기 부호 기반)을 쓰지 않았고, 스파크라인엔 a11y 라벨이 없었다.
 *  C4) 자산곡선 데이터점 r=3~5px(<44pt) + 점별 a11y 라벨/Role 부재로 날짜·금액 조작 사실상 불가.
 *
 * 해결:
 *  C7) 두 컴포넌트 모두 라인 색 = sparklineTrendColor(기울기 부호), 색맹 대비 추세 라벨(상승/하락/횡보)
 *      동반, 스파크라인 컨테이너 accessibilityLabel 추가.
 *  C4) 각 점 위에 투명 44pt(minTouchTarget) Pressable 히트영역 오버레이 + 점별 accessibilityLabel(날짜·금액).
 *
 * 실행: npx tsx scripts/check-chart-trend-honesty.ts  (실패 시 exit 1)
 */
import './_setupDevGlobal.ts'; // 부작용: 전역 __DEV__ 주입(아래 import 보다 먼저)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { pnlColor, sparklineTrendColor, sparklineTrendLabel } from '../utils/signalDisplay.ts';
import { sizing } from '../theme/spacing.ts';

import type { ThemeColors } from '../theme/index.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  console.log(
    `${ok ? 'PASS' : 'FAIL'} | ${label} | got=${JSON.stringify(got)} want=${JSON.stringify(want)}`,
  );
}

// ── 1) C7 핵심: 추세색=기울기 부호, '마지막 점 부호'(pnlColor)와 분리 ────────────
// 하락 중이나 마지막 평가금액이 초기원금보다 양(+)인 곡선: 라인은 하락(error)이어야 한다.
const downButPositive = [10_500_000, 10_400_000, 10_300_000, 10_200_000]; // 첫>마지막(하락 추세)·전 구간 원금초과
check('하락추세 곡선 → 라인색 하락(error)', sparklineTrendColor(downButPositive, colors), 'ERROR');
// 마지막 점의 '원금 대비 부호'로 칠하던 버그였다면 +수익률이라 success 가 됐을 것.
const lastReturnPct = 2.0; // 마지막 점 +2.0%(원금 대비 양)
check('버그재현: 마지막점 부호색=상승(success)', pnlColor(lastReturnPct, colors), 'SUCCESS');
check(
  '정직계약: 라인색(하락) ≠ 마지막점 부호색(상승)',
  sparklineTrendColor(downButPositive, colors) !== pnlColor(lastReturnPct, colors),
  true,
);
// 역방향: 상승 중이나 음(-)인 곡선 → 라인 상승(success)
const upButNegative = [9_500_000, 9_600_000, 9_700_000, 9_800_000];
check('상승추세 곡선 → 라인색 상승(success)', sparklineTrendColor(upButNegative, colors), 'SUCCESS');

// ── 2) 추세 라벨(색맹 대비·낭독 병행) ──────────────────────────────────────────
check('라벨 하락', sparklineTrendLabel(downButPositive), '하락');
check('라벨 상승', sparklineTrendLabel(upButNegative), '상승');
check('라벨 횡보(양끝 동일)', sparklineTrendLabel([100, 120, 100]), '횡보');
check('라벨 점부족 → 빈문자열', sparklineTrendLabel([100]), '');

// ── 3) C4: 히트영역 한 변 = minTouchTarget(44) ───────────────────────────────
check('minTouchTarget = 44', sizing.minTouchTarget, 44);
check('히트영역 ≥ 44pt', sizing.minTouchTarget >= 44, true);

// ── 4) 소스 바인딩 — EquityCurveChart (C4+C7) ────────────────────────────────
const equitySrc = readFileSync(
  join(__dirname, '..', 'components', 'portfolio', 'EquityCurveChart.tsx'),
  'utf8',
);
check('[Equity] 라인색=sparklineTrendColor 사용', /sparklineTrendColor\(trendValues, colors\)/.test(equitySrc), true);
check('[Equity] 추세 라벨=sparklineTrendLabel 사용', /sparklineTrendLabel\(trendValues\)/.test(equitySrc), true);
check('[Equity] 회귀: 라인색이 pnlColor(last 가 아님', /pnlColor\(last\.returnPct/.test(equitySrc), false);
check('[Equity] 히트영역 한 변 = sizing.minTouchTarget(HIT)', /const HIT = sizing\.minTouchTarget/.test(equitySrc), true);
check('[Equity] 투명 히트영역 Pressable + 좌표 오프셋', /styles\.pointHit,\s*\{ left: xFor\(i\) - HIT \/ 2, top: yFor/.test(equitySrc), true);
check('[Equity] 히트영역 accessibilityRole=button', /accessibilityRole="button"/.test(equitySrc), true);
check('[Equity] 점별 a11y 라벨(날짜·금액)', /accessibilityLabel=\{`\$\{pointLabel\(p\)\} 모의 평가금액/.test(equitySrc), true);
// 회귀: 시각용 <Circle/> 요소 자체엔 onPress 가 없어야 한다(조작은 Pressable 히트영역이 담당).
const circleEl = equitySrc.match(/<Circle\b[\s\S]*?\/>/)?.[0] ?? '';
check('[Equity] 회귀: 작은 Circle onPress 잔존 없음', /onPress/.test(circleEl), false);
// onPress 는 정확히 1곳(Pressable 히트영역)에서만 — 점 조작 단일 경로 보장.
check('[Equity] onPress 1곳(Pressable 히트영역)', (equitySrc.match(/onPress=/g) ?? []).length, 1);
check('[Equity] pointHit 스타일 width=HIT', /pointHit:\s*\{[\s\S]*?width: HIT,[\s\S]*?height: HIT,/.test(equitySrc), true);
check('[Equity] 추세 라벨 텍스트 렌더', /추세 \{trendLabel\}/.test(equitySrc), true);

// ── 5) 소스 바인딩 — PerformanceSparkline (C7) ───────────────────────────────
const sparkSrc = readFileSync(
  join(__dirname, '..', 'components', 'portfolio', 'PerformanceSparkline.tsx'),
  'utf8',
);
check('[Spark] 라인색=sparklineTrendColor 사용', /sparklineTrendColor\(values, colors\)/.test(sparkSrc), true);
check('[Spark] 회귀: pnlColor 미사용', /pnlColor/.test(sparkSrc), false);
check('[Spark] 컨테이너 accessibilityLabel(추세) 추가', /누적 수익률 추세 \$\{trendLabel\}/.test(sparkSrc), true);
check('[Spark] 색맹 대비 추세 아이콘(Feather) 동반', /trendLabel === '상승' \? 'trending-up'/.test(sparkSrc), true);

if (failed > 0) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed.');
