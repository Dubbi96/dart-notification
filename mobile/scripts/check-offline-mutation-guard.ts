/**
 * DAR-226 결정론적 검증: 오프라인 쓰기 차단의 순수 로직(utils/offlineMutation.ts).
 * 실행: npx tsx scripts/check-offline-mutation-guard.ts  (실패 시 exit 1)
 *
 * 배경: QueryClient mutation 기본 networkMode='online' 은 오프라인 토글을 paused 로 메모리에만 남기고,
 *   낙관적 onMutate 만 캐시에 반영된 뒤 앱 종료 시 paused mutation 유실 → 다음 실행 invalidate 가
 *   서버값으로 되돌리며 '조용한 롤백'. 가드는 오프라인이면 토글을 낙관적 변경 전에 막아 롤백을 원천 차단한다.
 * 여기서는 (1) 차단 판정, (2) 차단 안내 평문, (3) mutateAsync 거부 시 센티넬 에러를 소비처가
 *   일반 '실패'와 구분하는 isOfflineMutationBlockedError 분기를 단정한다.
 */
import {
  OFFLINE_MUTATION_NOTICE,
  shouldBlockMutation,
  OfflineMutationBlockedError,
  isOfflineMutationBlockedError,
} from '../utils/offlineMutation.ts';

interface Case {
  name: string;
  got: unknown;
  expected: unknown;
}

const cases: Case[] = [
  // 1) 차단 판정: 오프라인일 때만 차단(미확정→online 은 useNetworkStatus 단계에서 false 로 들어옴).
  { name: 'shouldBlockMutation(true) → 차단', got: shouldBlockMutation(true), expected: true },
  { name: 'shouldBlockMutation(false) → 통과', got: shouldBlockMutation(false), expected: false },

  // 2) 안내 평문(색 단독 의미 금지) — 평문 한국어, '오프라인' 명시.
  { name: '안내 메시지 평문', got: OFFLINE_MUTATION_NOTICE, expected: '오프라인 — 인터넷 연결 후 다시 시도해 주세요' },
  { name: '안내 메시지에 "오프라인" 포함', got: OFFLINE_MUTATION_NOTICE.includes('오프라인'), expected: true },

  // 3) 센티넬 에러 식별: 차단 에러는 true, 그 외(일반 실패/네트워크/널/문자열)는 false.
  { name: '센티넬 에러 → true', got: isOfflineMutationBlockedError(new OfflineMutationBlockedError()), expected: true },
  { name: 'instanceof 보존', got: new OfflineMutationBlockedError() instanceof OfflineMutationBlockedError, expected: true },
  { name: '플래그 덕타이핑 → true', got: isOfflineMutationBlockedError({ isOfflineMutationBlocked: true }), expected: true },
  { name: '일반 Error → false(일반 실패 메시지 노출)', got: isOfflineMutationBlockedError(new Error('서버 오류')), expected: false },
  { name: 'axios 류 객체 → false', got: isOfflineMutationBlockedError({ response: { status: 422 } }), expected: false },
  { name: 'null → false', got: isOfflineMutationBlockedError(null), expected: false },
  { name: 'undefined → false', got: isOfflineMutationBlockedError(undefined), expected: false },
  { name: '문자열 → false', got: isOfflineMutationBlockedError('offline'), expected: false },
];

let failed = 0;
for (const c of cases) {
  const ok = c.got === c.expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name} → ${String(c.got)} (expected ${String(c.expected)})`);
}

if (failed > 0) {
  console.error(`\n${failed} case(s) failed`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} cases passed`);
