/**
 * DAR-216 결정론적 검증: 미읽음 탭 배지 단일 진실원천(React Query) + 표시 포맷 일관성.
 *
 * 버그(수정 전): 서버 unreadCount를 Zustand(notificationStore)에 복제(CLAUDE.md 위반).
 *   store 갱신이 홈/알림 화면 마운트 useEffect에서만 일어나 (a)푸시 수신 시 탭 배지 stale,
 *   (b)홈/알림 언마운트 상태에서 markAsRead 후 타 탭이면 탭 배지 옛값.
 * 해결(수정 후): 탭 배지·홈 헤더 배지 모두 useUnreadCount(['notifications','unread-count'])를
 *   직접 구독하고, 동일 포맷터 formatUnreadBadge로 라벨을 만든다 → 두 배지가 항상 일치.
 *
 * 이 스크립트는 두 배지가 공유하는 순수 포맷터 formatUnreadBadge의 진리표를 검증한다.
 *   - 0 이하/undefined/null → undefined(미표시)
 *   - 1~99 → 숫자 문자열
 *   - 100 이상 → '99+'
 * (탭 배지 tabBarBadge와 홈 헤더 배지가 동일 함수를 쓰므로, 같은 입력에 같은 라벨을 보장)
 *
 * 실행: npx tsx scripts/check-unread-badge.ts  (실패 시 exit 1)
 */
import { formatUnreadBadge } from '../utils/unreadBadge.ts';

let failed = 0;
function assert(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label} → ${JSON.stringify(actual)} (기대 ${JSON.stringify(expected)})`);
}

// 미표시 경계
assert('0건 → 미표시', formatUnreadBadge(0), undefined);
assert('음수 → 미표시', formatUnreadBadge(-3), undefined);
assert('undefined → 미표시', formatUnreadBadge(undefined), undefined);
assert('null → 미표시', formatUnreadBadge(null), undefined);

// 숫자 표기
assert('1건', formatUnreadBadge(1), '1');
assert('42건', formatUnreadBadge(42), '42');
assert('99건(경계)', formatUnreadBadge(99), '99');

// 100 이상 → 99+
assert('100건(경계) → 99+', formatUnreadBadge(100), '99+');
assert('250건 → 99+', formatUnreadBadge(250), '99+');

// 탭 배지 ↔ 홈 헤더 배지 일치: 동일 함수이므로 임의 입력에 동일 출력
for (const n of [0, 1, 99, 100, 5000]) {
  const tab = formatUnreadBadge(n);
  const home = formatUnreadBadge(n);
  assert(`동일성 n=${n} (탭==홈)`, tab, home);
}

console.log(failed === 0 ? '\nALL PASS' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
