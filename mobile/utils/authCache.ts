import type { QueryClient } from '@tanstack/react-query';

/**
 * 인증 상태 전환(로그인 성공 / 로그아웃 / 401·403 세션 만료) 시 이전 세션의 모든 서버 캐시를
 * 제거한다. 같은 기기에서 계정이 바뀌면 gcTime(기본 5분) 내에 이전 사용자의
 * `[users,me]`·`[watchlist]`·`[positions]`·`[portfolio,summary]`·`[saved-disclosures]` 등
 * 금융/개인정보가 React Query 캐시에 남아 다음 사용자(또는 게스트→로그인 전환)에게
 * 교차 노출되는 결함을 차단한다(DAR-262).
 *
 * 토큰 회전(refresh)은 같은 사용자 세션이므로 캐시를 비우지 않는다 — 이 헬퍼는
 * 로그인/로그아웃 등 "주체(subject)가 바뀌는" 경계에서만 호출한다.
 */
export function purgeServerCache(client: QueryClient): void {
  // 진행 중 쿼리 취소 + 캐시 전량 삭제(관찰자 없는 데이터까지). removeQueries 가 아닌 clear 로
  // mutation 캐시까지 포함해 세션 잔여를 남기지 않는다.
  client.clear();
}
