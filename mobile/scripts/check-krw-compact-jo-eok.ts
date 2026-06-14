/**
 * DAR-255 결정론적 검증: formatKrwCompact 조/억 표기.
 *
 * 버그(수정 전): keyFigures.ts 의 formatKrwCompact 가 억/만 분기만 있어
 *   조(1e12) 미처리 → 5조(5e12)가 '50,000억원'으로 표기되어 한국 금융관례(조/억 혼합)와
 *   어긋나고 대형 공급계약·발행총액 가독성이 급락했다.
 *
 * 수정 후: abs>=조 분기를 최상단에 추가해 'N조 M억원'(억 나머지 有) / 'N조원'(나머지 0)으로
 *   표기하고, 억 구간은 값 크기에 따라 동적(10억 미만 소수1, 이상 정수).
 *
 * 실행: npx tsx scripts/check-krw-compact-jo-eok.ts  (실패 시 exit 1)
 * RN 의존 없음(순수 함수 직접 호출).
 */
import { formatKrwCompact } from '../utils/keyFigures.ts';

interface Case {
  name: string;
  pass: boolean;
  detail: string;
}

const cases: Case[] = [];
function expect(name: string, input: number, expected: string) {
  const got = formatKrwCompact(input);
  cases.push({ name, pass: got === expected, detail: `${input} → "${got}" (기대 "${expected}")` });
}

// --- DoD 경계 ---
// 1.23억 = 1.23e8: 10억 미만 → 소수1.
expect('1.23억 → 1.2억원(소수1)', 1_2300_0000, '1.2억원');
// 5조 = 5e12: 조 분기, 억 나머지 0 → 'N조원'(과거 버그 50,000억원 제거).
expect('5조 → 5조원(조 표기)', 5_0000_0000_0000, '5조원');
// -3.5억 = -3.5e8: 음수·10억 미만 → 소수1, 부호 보존.
expect('-3.5억 → -3.5억원(음수·소수1)', -3_5000_0000, '-3.5억원');
// 9999만 = 9999e4: 억 미만 → 만원.
expect('9999만 → 9,999만원(만 구간)', 9999_0000, '9,999만원');

// --- 조/억 혼합 표기 ---
// 5조 3000억 = 5.3e12 → 'N조 M억원'.
expect('5조 3000억 → 5조 3,000억원', 5_3000_0000_0000, '5조 3,000억원');
// 1조 정확 → '1조원'.
expect('1조 → 1조원', 1_0000_0000_0000, '1조원');
// 12조 3456억 → 천단위 콤마.
expect('12조 3456억 → 12조 3,456억원', 12_3456_0000_0000, '12조 3,456억원');
// 음수 조: -2조 500억 → 부호 보존.
expect('-2조 500억 → -2조 500억원', -2_0500_0000_0000, '-2조 500억원');

// --- 억 구간 동적 자릿수 경계 ---
// 10억 정확 → 정수(>=10억).
expect('10억 → 10억원(정수)', 10_0000_0000, '10억원');
// 12.7억(>=10억) → 정수 반올림 → 13억원.
expect('12.7억 → 13억원(정수 반올림)', 12_7000_0000, '13억원');
// 9.5억(<10억) → 소수1 → 9.5억원.
expect('9.5억 → 9.5억원(소수1)', 9_5000_0000, '9.5억원');
// 정확히 1억 → 1억원.
expect('1억 → 1억원', 1_0000_0000, '1억원');

// --- 만/원 구간 회귀 ---
expect('1만 → 1만원', 1_0000, '1만원');
expect('0 → 0원', 0, '0원');
expect('5000원 → 5,000원', 5000, '5,000원');
expect('-9999만 → -9,999만원(부호)', -9999_0000, '-9,999만원');

// --- 조 경계 올림(억 나머지 반올림이 1조에 닿는 희귀 케이스) ---
// 1조 9999.6억 → 억 단위 round 20000억 → 자동 올림 2조원(나머지 0).
expect('조경계 반올림 올림 → 2조원', 1_9999_6000_0000, '2조원');

let failed = 0;
for (const c of cases) {
  const tag = c.pass ? 'PASS' : 'FAIL';
  if (!c.pass) failed++;
  // eslint-disable-next-line no-console
  console.log(`[${tag}] ${c.name} :: ${c.detail}`);
}
// eslint-disable-next-line no-console
console.log(`\n${cases.length - failed}/${cases.length} passed`);
if (failed > 0) process.exit(1);
