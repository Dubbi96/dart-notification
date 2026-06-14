/**
 * DAR-225 결정론적 검증: 푸시 토큰 등록 재시도 정책(utils/pushTokenRetry).
 * 실행: npx tsx scripts/check-push-token-retry.ts  (실패 시 exit 1)
 *
 * 콜드스타트 네트워크 단절로 토큰 등록이 1회 실패한 뒤 세션 내내 미등록되는 회귀를 막기 위해:
 *   (1) 백오프 재시도 스케줄이 1~2회·점증인지
 *   (2) 네트워크 복구 시 "온라인 AND 미등록"일 때만 재시도하는지(진리표)
 * 를 순수 함수로 검증한다.
 */
import { REGISTER_BACKOFF_MS, shouldRetryOnReconnect } from '../utils/pushTokenRetry.ts';

let failures = 0;
function assert(name: string, cond: boolean) {
  if (cond) {
    console.log(`  ok: ${name}`);
  } else {
    console.error(`  FAIL: ${name}`);
    failures += 1;
  }
}

// (1) 백오프 스케줄: DoD "최소 1~2회 백오프 재시도"
assert('백오프 1~2회 재시도', REGISTER_BACKOFF_MS.length >= 1 && REGISTER_BACKOFF_MS.length <= 2);
assert('모든 지연 양수', REGISTER_BACKOFF_MS.every((d) => d > 0));
assert(
  '지연 점증(과도 폭주 방지)',
  REGISTER_BACKOFF_MS.every((d, i) => i === 0 || d > REGISTER_BACKOFF_MS[i - 1]),
);

// (2) shouldRetryOnReconnect 진리표: 온라인 AND 미등록일 때만 true
interface Case {
  name: string;
  isOnline: boolean;
  registeredToken: string | null;
  expected: boolean;
}
const cases: Case[] = [
  { name: '복구(online)+미등록 → 재시도', isOnline: true, registeredToken: null, expected: true },
  { name: '복구(online)+이미등록 → 미재시도(중복방지)', isOnline: true, registeredToken: 'ExponentPushToken[x]', expected: false },
  { name: '오프라인+미등록 → 미재시도', isOnline: false, registeredToken: null, expected: false },
  { name: '오프라인+이미등록 → 미재시도', isOnline: false, registeredToken: 'ExponentPushToken[x]', expected: false },
];
for (const c of cases) {
  assert(c.name, shouldRetryOnReconnect(c.isOnline, c.registeredToken) === c.expected);
}

if (failures > 0) {
  console.error(`\n${failures}건 실패`);
  process.exit(1);
}
console.log(`\n전체 통과 (${3 + cases.length}건)`);
