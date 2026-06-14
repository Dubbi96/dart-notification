/**
 * DAR-290 결정론적 검증: relativeTime 미래 시각 가드.
 *
 * 근거: utils/datetime.ts relativeTime 은 raw formatDistanceToNow(addSuffix:true) 라
 * iso 가 현재보다 미래면 'N초 후'·'N분 후' 가 나온다. 그러나 소비처(분석 시각·시세 시각 등)
 * 는 전부 항상-과거 이벤트라, 서버>기기 클럭 스큐 시 '분석 5초 후' 같은 무의미 표기가 노출됐다.
 *
 * 해결: 현재 이후(now 포함) → '방금', 과거 → 기존 formatDistanceToNow 경로 유지.
 *  - 미래 iso → '방금'
 *  - 동시각(now) → '방금'
 *  - 과거 iso → 기존 'N분 전' 동작 동일(raw formatDistanceToNow 대조), '후' 미출현
 *
 * 실행: npx tsx scripts/check-relative-time-future-guard.ts  (실패 시 exit 1)
 */
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';

import { relativeTime, relativeTimeOrFallback } from '../utils/datetime.ts';

let failed = 0;
function check(label: string, got: unknown, want: unknown): void {
  const ok = got === want;
  if (!ok) failed += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label} | got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
}
function checkTrue(label: string, cond: boolean): void {
  if (!cond) failed += 1;
  console.log(`${cond ? 'PASS' : 'FAIL'} | ${label}`);
}

const now = Date.now();
const iso = (offsetMs: number): string => new Date(now + offsetMs).toISOString();

// 1) 미래 시각 → '방금' (클럭 스큐 핵심 케이스)
check('미래 +5초 → 방금', relativeTime(iso(5_000)), '방금');
check('미래 +5분 → 방금', relativeTime(iso(5 * 60_000)), '방금');
check('미래 +2시간 → 방금', relativeTime(iso(2 * 3_600_000)), '방금');

// 2) 동시각(now) → '방금' (경계: 음수 아님)
// 두 번의 Date.now() 사이 ms 진행을 제거하기 위해 클럭을 고정해 경계를 결정론적으로 검증한다.
const FIXED = 1_700_000_000_000;
const realNow = Date.now;
Date.now = () => FIXED;
try {
  check('동시각(now) → 방금', relativeTime(new Date(FIXED).toISOString()), '방금');
  check('직전(now-1ms) → 1분 미만 전', relativeTime(new Date(FIXED - 1).toISOString()), '1분 미만 전');
} finally {
  Date.now = realNow;
}

// 3) 과거 시각 → 기존 'N분 전' 동작 동일 (raw formatDistanceToNow 대조: 회귀0)
for (const [label, off] of [
  ['과거 -5분', -5 * 60_000],
  ['과거 -3시간', -3 * 3_600_000],
  ['과거 -2일', -2 * 86_400_000],
] as const) {
  const past = iso(off);
  const raw = formatDistanceToNow(new Date(past), { addSuffix: true, locale: ko });
  check(`${label} == raw formatDistanceToNow`, relativeTime(past), raw);
  checkTrue(`${label} 은 '전'으로 끝남`, relativeTime(past).endsWith('전'));
  checkTrue(`${label} 에 '후' 미출현`, !relativeTime(past).includes('후'));
}

// 4) 미래/동시각 모두 '후' 미출현 (정직화 입증)
checkTrue('미래 표기에 후 미출현', !relativeTime(iso(30_000)).includes('후'));

// 5) relativeTimeOrFallback 자동 수혜: 미래 → '방금'(폴백 아님), 결측 → 폴백 유지
check('OrFallback 미래 → 방금', relativeTimeOrFallback(iso(10_000)), '방금');
check('OrFallback null → 폴백', relativeTimeOrFallback(null), '기록 없음');
check('OrFallback 잘못된 문자열 → 폴백', relativeTimeOrFallback('not-a-date'), '기록 없음');
check('OrFallback 과거 → 기존 동작', relativeTimeOrFallback(iso(-5 * 60_000)), relativeTime(iso(-5 * 60_000)));

if (failed > 0) {
  console.error(`\n${failed} check(s) FAILED`);
  process.exit(1);
}
console.log('\nAll checks passed.');
