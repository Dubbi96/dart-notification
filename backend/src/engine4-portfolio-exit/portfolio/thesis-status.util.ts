/**
 * PositionThesis 생명주기 상태(DB) → 화면용 ThesisStatus 매핑.
 *
 * DB enum(`ThesisStatus`)은 단방향 FSM `ACTIVE → INVALIDATED → CLOSED`(position-thesis.types.ts)로
 * 모델링돼 있고, 모바일/응답 도메인은 `ACTIVE | WATCHING | VIOLATED | EXPIRED`이다.
 * 두 도메인의 어휘가 달라 raw cast는 INVALIDATED/CLOSED를 화면에 그대로 흘려 깨뜨린다(데드 매핑).
 *
 * 매핑 규칙(Rule, AI 금지영역 무관):
 *  - INVALIDATED → VIOLATED  (논리 훼손 — Engine4 핵심가치)
 *  - CLOSED      → EXPIRED   (논리 만료/청산 완료)
 *  - ACTIVE      → ACTIVE
 *  - thesis 없음 / 미지의 값 → ACTIVE (안전 기본값)
 *
 * 주의: WATCHING은 DB 상태로 표현되지 않으므로(근접-훼손 평가는 별도·미영속) 이 매핑은 절대 WATCHING을 내지 않는다.
 */

/** 화면/응답용 thesis 상태 도메인. */
export type ThesisDisplayStatus = 'ACTIVE' | 'WATCHING' | 'VIOLATED' | 'EXPIRED';

/** DB(PositionThesis.status) enum 도메인. */
export type DbThesisStatus = 'ACTIVE' | 'INVALIDATED' | 'CLOSED';

/**
 * thesis 상태를 화면용 도메인으로 매핑한다.
 * @param status PositionThesis.status (없으면 null/undefined)
 */
export function mapThesisStatus(
  status: string | null | undefined,
): ThesisDisplayStatus {
  switch (status) {
    case 'INVALIDATED':
      return 'VIOLATED';
    case 'CLOSED':
      return 'EXPIRED';
    case 'ACTIVE':
      return 'ACTIVE';
    default:
      // thesis 미연결 또는 알 수 없는 값 → 안전 기본값.
      return 'ACTIVE';
  }
}
