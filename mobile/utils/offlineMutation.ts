// DAR-226: 오프라인 쓰기(mutation) 차단의 순수 로직 SSOT.
// 배경: QueryClient mutation 의 기본 networkMode='online' → 오프라인 토글은 paused 로 메모리에만 남고,
//   낙관적 onMutate 만 캐시에 반영된 뒤 앱 종료 시 paused mutation 이 유실 → 다음 실행의 invalidate 가
//   서버값으로 되돌리며 변경이 '조용히 롤백'된다('껐다 켰더니 되돌아감').
// 해결: 오프라인일 때 토글을 낙관적 업데이트 전에 막고 평문 안내. 낙관적 변경이 없으니 롤백도 없고
//   앱 재시작 후 캐시-서버 정합이 결정적으로 보장된다.
// 이 파일은 RN/React Query 의존 없는 순수 로직(메시지·판정·센티넬 에러) — tsc·진리표로 단독 검증.

/** 오프라인 토글 차단 시 스낵바에 띄우는 평문 안내(SSOT). 색 단독 의미 금지 — 평문. */
export const OFFLINE_MUTATION_NOTICE =
  '오프라인 — 인터넷 연결 후 다시 시도해 주세요';

/** 차단 스낵바 노출 시간(ms). 실패 계열이라 충분히 길게(§3-1 실패 4000 준거, 차단은 3000). */
export const OFFLINE_MUTATION_NOTICE_DURATION = 3000;

/**
 * 오프라인 차단 여부(순수 판정). 현재는 isOffline 그대로지만, 차단 규칙의 단일 출처로 명문화해
 * 화면/훅이 동일 규칙을 쓰게 한다(드리프트 방지). 미확정(null)은 useNetworkStatus 에서 이미 online 처리.
 */
export function shouldBlockMutation(isOffline: boolean): boolean {
  return isOffline === true;
}

/**
 * 오프라인 차단으로 거부된 mutateAsync 를 식별하는 센티넬 에러.
 * mutateAsync 소비처(공시 상세 토글 등)가 일반 '실패' 메시지로 차단 안내를 덮지 않도록 구분한다.
 */
export class OfflineMutationBlockedError extends Error {
  // 미니파이/instanceof 신뢰성 보강용 식별 플래그.
  readonly isOfflineMutationBlocked = true;
  constructor() {
    super(OFFLINE_MUTATION_NOTICE);
    this.name = 'OfflineMutationBlockedError';
  }
}

/** unknown 에러가 오프라인 차단 센티넬인지 판정(소비처 catch 분기용). */
export function isOfflineMutationBlockedError(error: unknown): boolean {
  if (error instanceof OfflineMutationBlockedError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { isOfflineMutationBlocked?: unknown }).isOfflineMutationBlocked === true
  );
}
