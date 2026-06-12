// DAR-173: 오프라인 인지 + stale 데이터 표식 순수 로직.
// 네트워크 단절 시 React Query 캐시의 옛값을 '정상'처럼 노출하지 않도록,
// 화면이 동일 규칙으로 (1) 오프라인 여부와 (2) 마지막 갱신 경과를 평문 라벨로 그릴 수 있게 한다.
// RN 의존 없음·부수효과 없음(tsc·진리표 검증 용이, 색 단독 의미 금지 — 라벨은 평문).

/** useNetInfo / NetInfo.addEventListener 상태의 최소 형태(오프라인 판정 입력). */
export interface NetConnectivity {
  /** 물리 연결 여부. null/undefined=미확정. */
  isConnected?: boolean | null;
  /** 인터넷 도달 가능 여부(captive portal 등). null/undefined=미확정. */
  isInternetReachable?: boolean | null;
}

/**
 * 오프라인 판정. 미확정(null/undefined)은 '온라인'으로 간주해 오탐 배너를 막는다.
 * (isConnected===false 또는 isInternetReachable===false 인 명시 단절만 오프라인)
 */
export function isOffline(state: NetConnectivity): boolean {
  return state.isConnected === false || state.isInternetReachable === false;
}

/** onlineManager 용 — 오프라인 판정의 역(online = !offline). 미확정은 online. */
export function isOnline(state: NetConnectivity): boolean {
  return !isOffline(state);
}

/** updatedAt(ms) 이후 경과 분(내림). updatedAt 미상/0(미갱신)이면 null. 미래값은 0으로 클램프. */
export function minutesSince(updatedAt: number | null | undefined, now: number): number | null {
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt <= 0) return null;
  const diffMs = now - updatedAt;
  if (diffMs < 0) return 0;
  return Math.floor(diffMs / 60000);
}

/**
 * 오프라인 보조 라벨. 마지막 성공 갱신 시각 기준 경과를 평문으로(과신·옛값 오인 방지).
 * - updatedAt 미상 → '오프라인 — 캐시된 값'
 * - <1분        → '오프라인 — 방금 갱신'
 * - <60분       → '오프라인 — 마지막 갱신 N분 전'
 * - 그 이상      → '오프라인 — 마지막 갱신 N시간 전'
 */
export function offlineStaleLabelAt(updatedAt: number | null | undefined, now: number): string {
  const mins = minutesSince(updatedAt, now);
  if (mins === null) return '오프라인 — 캐시된 값';
  if (mins < 1) return '오프라인 — 방금 갱신';
  if (mins < 60) return `오프라인 — 마지막 갱신 ${mins}분 전`;
  const hours = Math.floor(mins / 60);
  return `오프라인 — 마지막 갱신 ${hours}시간 전`;
}

/**
 * offlineStaleLabelAt 의 현재시각 래퍼(렌더에서 Date.now 직접 호출 회피 — ProvenanceBar.relativeTime 패턴).
 * 순수 검증은 offlineStaleLabelAt(updatedAt, now) 로 한다.
 */
export function offlineStaleLabel(updatedAt: number | null | undefined): string {
  return offlineStaleLabelAt(updatedAt, Date.now());
}
