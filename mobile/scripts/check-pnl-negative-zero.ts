/**
 * DAR-312 결정론적 검증: 손익 0 의 음수영점 표시(-0.0%) + 손실색 제거.
 *
 * 증거(에뮬): 매도 카드(ExitScoreCard)에서 손익 0(또는 -0.04 처럼 0.0 으로 반올림되는
 * 음수)이 '현재 손익: -0.0%' 로 빨간색·마이너스와 함께 손실처럼 표시됐다.
 * 원인: 정본 numberFormat.formatReturnPct 가 반올림 전 원시 부호를 썼고
 *   - `(-0.04).toFixed(1)` === "-0.0"  → toFixed 가 마이너스를 보존해 "-0.0%"
 *   - returnColor 는 `value < 0` 원시 부호로 분기 → error(빨강)
 * 즉 표기 문자열은 0 인데 부호·색은 손실이었다.
 *
 * 해결(정본 SSOT 교정, 전역 일관):
 *   - formatReturnPct: 표시 자릿수로 반올림한 뒤 0 이면 부호 제거(roundToDisplay, -0 정규화)
 *   - returnColor/pnlColor: 같은 반올림 부호로 색 결정(반올림 후 0 → textSecondary 보합색)
 *   - +/-/0 대칭 일관: 양수영점(+0.04→0.0%)도 '+' 제거
 *
 * ExitScoreCard 표기 경로 = formatPnlPercent(=formatReturnPct digits:1),
 * 색 경로 = pnlColor(=returnColor). 두 별칭으로 실제 카드가 부르는 경로를 그대로 검증한다.
 *
 * 실행: npx tsx scripts/check-pnl-negative-zero.ts   (실패 시 exit 1)
 */
import './_setupDevGlobal.ts'; // 부작용: 전역 __DEV__ 주입(아래 signalDisplay import 보다 먼저)
import { formatReturnPct, returnColor } from '../utils/numberFormat.ts';
import { formatPnlPercent, pnlColor } from '../utils/signalDisplay.ts';

// 색 토큰 식별만 필요 — returnColor 가 반환한 토큰이 어느 의미인지 라벨로 역매핑.
const colors = {
  success: 'SUCCESS',
  error: 'ERROR',
  textSecondary: 'NEUTRAL',
} as unknown as Parameters<typeof returnColor>[1];

let failed = 0;
function check(label: string, got: unknown, want: unknown): void {
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label} | got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
}

// 옛(버그) 로직 — 회귀 대조군. 반올림 전 원시 부호.
const oldFormat = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
const oldColor = (v: number) => (v > 0 ? 'SUCCESS' : v < 0 ? 'ERROR' : 'NEUTRAL');

// ── 1) 버그 재현: 옛 로직은 -0.04 를 "-0.0%" + ERROR 로 표시 (이 이슈의 증거) ──
check('버그 재현: 옛 포맷 -0.04 → -0.0%', oldFormat(-0.04), '-0.0%');
check('버그 재현: 옛 색 -0.04 → ERROR', oldColor(-0.04), 'ERROR');

// ── 2) 수정 후 매도 카드 경로(formatPnlPercent/pnlColor): 음수영점 제거 ──
check('카드 표기 -0.04 → 부호 없는 0.0%', formatPnlPercent(-0.04), '0.0%');
check('카드 색 -0.04 → 보합 NEUTRAL', pnlColor(-0.04, colors), 'NEUTRAL');
check('카드 표기 0 → 0.0%', formatPnlPercent(0), '0.0%');
check('카드 색 0 → NEUTRAL', pnlColor(0, colors), 'NEUTRAL');
check('카드 표기 -0(음수영점) → 0.0%', formatPnlPercent(-0), '0.0%');
check('카드 색 -0(음수영점) → NEUTRAL', pnlColor(-0, colors), 'NEUTRAL');

// ── 3) 대칭: 양수영점도 부호·색 중립 ──
check('양수영점 +0.04 → 0.0%', formatPnlPercent(0.04), '0.0%');
check('양수영점 +0.04 색 → NEUTRAL', pnlColor(0.04, colors), 'NEUTRAL');

// ── 4) 실제 손익/이익은 기존대로 부호·색 유지(회귀 없음) ──
check('실손실 -3.2 → -3.2%', formatPnlPercent(-3.2), '-3.2%');
check('실손실 -3.2 색 → ERROR', pnlColor(-3.2, colors), 'ERROR');
check('실이익 +5.7 → +5.7%', formatPnlPercent(5.7), '+5.7%');
check('실이익 +5.7 색 → SUCCESS', pnlColor(5.7, colors), 'SUCCESS');
// 반올림 경계: -0.05 는 1자리에서 -0.1 → 손실 유지(영점 아님)
check('경계 -0.05 → -0.1%(영점 아님)', formatPnlPercent(-0.05), '-0.1%');
check('경계 -0.05 색 → ERROR', pnlColor(-0.05, colors), 'ERROR');

// ── 5) 자릿수 일관: digits 인자로 표기·색이 같은 정밀도로 판정 ──
// 2자리 표기면 -0.04 는 "-0.04%"(유효 손실) → 색도 ERROR 여야 표기와 일치
check('2자리 표기 -0.04 → -0.04%', formatReturnPct(-0.04, { digits: 2 }), '-0.04%');
check('2자리 색 -0.04 → ERROR', returnColor(-0.04, colors, { digits: 2 }), 'ERROR');
// 2자리에서도 -0.004 는 0.00 으로 반올림 → 보합
check('2자리 -0.004 → 0.00%', formatReturnPct(-0.004, { digits: 2 }), '0.00%');
check('2자리 색 -0.004 → NEUTRAL', returnColor(-0.004, colors, { digits: 2 }), 'NEUTRAL');

// ── 6) 표기 부호 ↔ 색 정합 불변식: 표기에 '-' 가 있으면 ERROR, '+' 면 SUCCESS, 무부호면 NEUTRAL ──
for (const v of [-12.3, -0.04, -0, 0, 0.04, 7.8, 0.05, -0.05]) {
  const txt = formatPnlPercent(v);
  const col = pnlColor(v, colors);
  const want = txt.startsWith('-') ? 'ERROR' : txt.startsWith('+') ? 'SUCCESS' : 'NEUTRAL';
  check(`정합 불변식 v=${v} (${txt}→${col})`, col, want);
}

if (failed > 0) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed.');
