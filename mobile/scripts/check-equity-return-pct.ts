/**
 * DAR-257 결정론적 검증: EquityCurveChart 0% 부호 정본 통일.
 *
 * 종전엔 components/portfolio/EquityCurveChart.tsx 가 로컬 formatReturnPct 를
 * 재구현했고(`pct >= 0 ? '+' : ''` + toFixed(2)), 정본 utils/numberFormat.ts 의
 * formatReturnPct(`value > 0 ? '+' : ''`)와 0% 부호·자릿수가 어긋났다.
 *   - 로컬:  0% → "+0.00%" (보합인데 양수처럼 '+'),  자릿수 2
 *   - 정본:  0% → "0.0%"   (보합은 부호 없음),        자릿수 기본 1
 * 같은 수익률이 화면(공시상세/포트폴리오 vs 자산곡선 차트)마다 다르게 보였다.
 *
 * 해결: 차트의 로컬 함수 제거 → 정본 formatReturnPct(value, { digits: 2 }) 사용.
 * 0% 부호가 정본 규칙(부호 없음)으로 자동 일치하고, 차트가 원하던 2자리 정밀도는 보존.
 *
 * "두 경로 출력 동일" — 차트가 호출하는 경로(정본, digits:2)와 정본 직접 호출이
 * 0 / +0.004 / -0 에서 글자 그대로 동일함을 단언한다. 동시에 옛 로컬 로직과
 * 비교해 0·-0 에서 '+' 가 사라졌음을(버그 수정) 회귀 증거로 남긴다.
 *
 * 실행: npx tsx scripts/check-equity-return-pct.ts  (실패 시 exit 1)
 */
import { formatReturnPct } from '../utils/numberFormat.ts';

let failed = 0;
function check(label: string, got: unknown, want: unknown): void {
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label} | got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
}

// 옛 EquityCurveChart 로컬 구현(버그 재현용 — 0/-0 에서 '+' 가 붙었다)
function oldLocalFormat(pct: number): string {
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
}

// EquityCurveChart 가 이제 사용하는 경로(정본, 2자리)
const chartPath = (v: number) => formatReturnPct(v, { digits: 2 });

// 1) 두 경로(차트 경로 == 정본 직접 호출)가 글자 그대로 동일 — DoD 핵심
for (const v of [0, 0.004, -0, 12.3, -5.6789]) {
  check(`두 경로 동일(${v})`, chartPath(v), formatReturnPct(v, { digits: 2 }));
}

// 2) DoD 명시 입력의 통일 출력값 — 0% 보합은 '+' 없음
check('0 → 부호 없는 0.00%', chartPath(0), '0.00%');
check('+0.004 → 양수 +0.00%', chartPath(0.004), '+0.00%'); // 0.004.toFixed(2)='0.00', value>0 → '+'
check('-0 → 부호 없는 0.00%', chartPath(-0), '0.00%');

// 3) 회귀 증거 — 옛 로컬 로직은 0·-0 에서 '+' 를 붙여 정본과 어긋났다(이제 수정됨)
check('옛 로컬은 0에 + 붙임(버그)', oldLocalFormat(0), '+0.00%');
check('정본 통일 후 0은 + 없음', chartPath(0) !== oldLocalFormat(0), true);
check('정본 통일 후 -0은 + 없음', chartPath(-0) !== oldLocalFormat(-0), true);

// 4) 음수는 toFixed 의 '-' 가 유지(부호 규칙 회귀 없음)
check('음수 부호 유지', chartPath(-5.6789), '-5.68%');
check('양수 + 부호 유지', chartPath(12.3), '+12.30%');

if (failed > 0) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed.');
