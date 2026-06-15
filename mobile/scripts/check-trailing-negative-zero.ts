/**
 * DAR-318 결정론적 검증: Thesis 청산 룰 트레일링(및 손절/익절) 0 의 음수·양수영점 표시 제거.
 *
 * 증거(에뮬, 케이씨씨 Thesis→청산 룰): 트레일링 임계가 0(미설정)인데 '고점 -0%' 로
 * 음수 부호가 붙어 표시됐다. 같은 카드의 손절 '-8%'·분할익절 '+25%' 는 정상.
 * 원인: thesis.tsx 가 청산 룰 임계를 `-{value}%`·`+{value}%`·`고점 -{value}%` 인라인
 *   템플릿으로 찍어 value=0 일 때도 방향 부호가 그대로 남았다(DAR-312 음수영점 가드 미적용 잔여).
 *
 * 해결(정본 SSOT): utils/numberFormat.formatExitRulePct(magnitude, direction).
 *   - magnitude 0(±0) → 부호 없는 "0%" (트레일링은 호출부에서 "고점 0%")
 *   - 0 이 아닌 값 → 기존 표기(원시 자릿수) 보존: 'loss'→"-8%", 'gain'→"+25%"
 *   - null/undefined/NaN → '—'
 *
 * 실행: npx tsx scripts/check-trailing-negative-zero.ts   (실패 시 exit 1)
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { formatExitRulePct } from '../utils/numberFormat.ts';

let failed = 0;
function check(label: string, got: unknown, want: unknown): void {
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label} | got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
}

// 옛(버그) 인라인 로직 — 회귀 대조군. 방향 부호를 무조건 붙인다.
const oldLoss = (v: number) => `-${v}%`;
const oldGain = (v: number) => `+${v}%`;

// ── A) 핵심 버그: 0(미설정) 케이스 부호 제거 ──────────────────────────────
check('trailing 0 → 부호 없는 0%', formatExitRulePct(0, 'loss'), '0%');
check('stopLoss 0 → 부호 없는 0%', formatExitRulePct(0, 'loss'), '0%');
check('takeProfit 0 → 부호 없는 0%', formatExitRulePct(0, 'gain'), '0%');
check('음수영점(-0) loss → 0%', formatExitRulePct(-0, 'loss'), '0%');
check('음수영점(-0) gain → 0%', formatExitRulePct(-0, 'gain'), '0%');

// 트레일링 호출부 합성(고점 접두) — '고점 -0%' 미표시, '고점 0%' 표시
check('트레일링 합성 0 → "고점 0%"', `고점 ${formatExitRulePct(0, 'loss')}`, '고점 0%');
check('대조군(옛 로직) 0 → "고점 -0%" (버그 재현)', `고점 ${oldLoss(0)}`, '고점 -0%');

// ── B) 회귀: 0 이 아닌 값은 기존 표기 그대로(부호+크기, 자릿수 보존) ─────────
check('stopLoss 8 → -8%', formatExitRulePct(8, 'loss'), oldLoss(8));
check('takeProfit 25 → +25%', formatExitRulePct(25, 'gain'), oldGain(25));
check('trailing 5 → -5%', formatExitRulePct(5, 'loss'), oldLoss(5));
check('소수 자릿수 보존 8.5 loss → -8.5%', formatExitRulePct(8.5, 'loss'), '-8.5%');
check('소수 자릿수 보존 25.5 gain → +25.5%', formatExitRulePct(25.5, 'gain'), '+25.5%');

// ── C) 결측/비정상 입력 ───────────────────────────────────────────────────
check('null → —', formatExitRulePct(null, 'loss'), '—');
check('undefined → —', formatExitRulePct(undefined, 'gain'), '—');
check('NaN → —', formatExitRulePct(Number.NaN, 'loss'), '—');

// ── D) 소스 바인딩: thesis.tsx 가 SSOT 헬퍼를 쓰고 인라인 부호 템플릿이 잔존하지 않음 ──
const thesisSrc = readFileSync(
  join(import.meta.dirname, '..', 'app/portfolio/[portfolioId]/position/[positionId]/thesis.tsx'),
  'utf8',
);
check('thesis.tsx 가 formatExitRulePct import', /from '@utils\/numberFormat'/.test(thesisSrc), true);
check('손절 헬퍼 경유', thesisSrc.includes("formatExitRulePct(thesis.exitRules.stopLossPercent, 'loss')"), true);
check('익절 헬퍼 경유', thesisSrc.includes("formatExitRulePct(thesis.exitRules.takeProfitPercent, 'gain')"), true);
check('트레일링 헬퍼 경유(고점 접두 유지)', thesisSrc.includes("고점 {formatExitRulePct(thesis.exitRules.trailingStopPercent, 'loss')}"), true);
check('인라인 음수영점 템플릿 -{...trailingStopPercent} 제거', /-\{thesis\.exitRules\.trailingStopPercent\}/.test(thesisSrc), false);
check('인라인 -{...stopLossPercent} 제거', /-\{thesis\.exitRules\.stopLossPercent\}/.test(thesisSrc), false);
check('인라인 +{...takeProfitPercent} 제거', /\+\{thesis\.exitRules\.takeProfitPercent\}/.test(thesisSrc), false);

console.log(`\n${failed === 0 ? 'ALL PASS' : `${failed} FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
