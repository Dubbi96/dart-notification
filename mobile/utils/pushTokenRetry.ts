// DAR-225: 푸시 토큰 등록 재시도 정책(순수 로직).
// 콜드스타트 네트워크 단절로 1회 실패한 뒤 세션 내내 디바이스 미등록(푸시 미수신)되는 것을 막기 위한
// (1) 백오프 재시도 지연 스케줄과 (2) 네트워크 복구(onlineManager online 전환) 시 재시도 여부 판정을
// 순수 함수로 분리한다. RN/Expo 의존 없음 — tsc·진리표로 결정론 검증한다.

/**
 * 등록 실패 시 백오프 재시도 지연(ms). 초기 즉시 시도가 실패하면 이 순서대로 1~2회 더 재시도한다.
 * 점증(1s→4s) — 일시적 단절이 짧으면 빨리 복구하고, 길어도 과도한 폭주 없이 따라잡는다.
 */
export const REGISTER_BACKOFF_MS: readonly number[] = [1000, 4000];

/**
 * 네트워크 복구(onlineManager 가 online 으로 전환) 시 토큰 등록을 재시도할지 판정.
 * - 온라인으로 전환됐고(isOnline === true)
 * - 아직 디바이스 토큰이 등록되지 않았을 때만(registeredToken == null) 재시도한다.
 * 이미 등록됐거나(중복 등록 방지) 오프라인 전환 이벤트면(낭비 방지) 재시도하지 않는다.
 */
export function shouldRetryOnReconnect(
  isOnline: boolean,
  registeredToken: string | null,
): boolean {
  return isOnline && registeredToken == null;
}
