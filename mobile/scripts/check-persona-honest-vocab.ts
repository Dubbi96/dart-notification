/**
 * DAR-205 결정론적 검증: persona '선택' 죽은 상태 → '비교 강조' 어휘 약화.
 *
 * 버그(before): selectedPersona 소비처가 전부 표시용 하이라이트인데 화면 어휘는 '선택'
 *   ("자동매매 persona 선택하기"·"선택한 모의운용 persona") — 고르면 신호 점수/추천이
 *   바뀐다는 오약속. 또 풀스크린 /persona와 인라인 PersonaTrackSection이 동일 선택 UI 중복.
 *
 * 수정(after): persona 카피의 단일 출처 PERSONA_EMPHASIS를 '비교 강조' 어휘로 정의하고,
 *   강조 토글은 순수 nextPersonaEmphasis로 단일화. 중복 풀스크린 /persona는 제거(인라인 통합).
 *
 * 실제 출고 상수/순수함수를 그대로 import 해 검증한다(누가 '선택' 오약속을 재도입하면 FAIL).
 */

import { PERSONA_EMPHASIS, nextPersonaEmphasis } from '../components/persona/personaDisplay';

import type { PhilosophyStyle } from '../types/style-comparison.types';

let failures = 0;
function check(name: string, cond: boolean, detail: string) {
  if (!cond) failures++;
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${name}\n   ${detail}`);
}

// ── 1) 강조 토글 진리표(순수) — '결과 반영'이 아니라 강조 on/off/전환만 ────────────────
const B: PhilosophyStyle = 'BUFFETT';
const L: PhilosophyStyle = 'LYNCH';
const toggleCases: { current: PhilosophyStyle | null; tapped: PhilosophyStyle; expect: PhilosophyStyle | null }[] = [
  { current: null, tapped: B, expect: B }, // 미강조 → 강조
  { current: B, tapped: B, expect: null }, // 같은 카드 재탭 → 강조 해제
  { current: B, tapped: L, expect: L }, // 다른 카드 → 강조 전환
  { current: L, tapped: L, expect: null }, // 재탭 해제
];
for (const c of toggleCases) {
  const got = nextPersonaEmphasis(c.current, c.tapped);
  check(
    `toggle(${c.current ?? 'null'}, ${c.tapped})`,
    got === c.expect,
    `기대=${c.expect ?? 'null'} 실제=${got ?? 'null'}`,
  );
}

// ── 2) 어휘 정직: '선택'(오약속어) 0건 · 사용자 노출 카피에 '강조' 존재 ───────────────
const copyValues = Object.entries(PERSONA_EMPHASIS);
for (const [key, value] of copyValues) {
  check(`no-선택 | ${key}`, !value.includes('선택'), `"${value}"`);
}
// 사용자에게 보이는 핵심 카피는 '강조' 의미를 명시(동작 정직).
const emphasisKeys: (keyof typeof PERSONA_EMPHASIS)[] = [
  'cardActionHint',
  'emphasizedBar',
  'a11yAction',
  'a11yEmphasized',
];
for (const k of emphasisKeys) {
  check(`has-강조 | ${k}`, PERSONA_EMPHASIS[k].includes('강조'), `"${PERSONA_EMPHASIS[k]}"`);
}

console.log(`\n결과: ${failures === 0 ? 'ALL PASS' : `${failures} FAIL`}`);
if (failures > 0) {
  console.error('FAILURES present');
  process.exit(1);
}
console.log('All cases passed');
