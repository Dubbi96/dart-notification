// backend/src/engine1-disclosure/pipeline/title-event-backfill.constants.ts
// W4 신호 검증: 제목 기반 과거 공시 이벤트 백필 관측 구분 마커 (스키마 변경 0).
//
// DisclosureEvent 는 백필 출처 컬럼이 없으므로 기존 필드 2개를 계약으로 사용한다:
//   - failReason(비고성 문자열)  = TITLE_ONLY_BACKFILL_MARKER → Prisma 동등 필터로 분리 집계 가능.
//   - extractedData.backfillSource = TITLE_BACKFILL_SOURCE     → JSON 레벨 관측 플래그(리포트/수동 검수용).
// 이 두 값은 DisclosureEvent(engine1 소유 모델)의 데이터 계약이다 — 타 엔진(예: engine2
// AI 백필 드레인)은 이 상수를 import 해 제목 백필 관측치를 제외/분리한다(서비스 호출 아님).

/** failReason 에 기록하는 제목 기반 백필 마커(Prisma where 동등 필터용). */
export const TITLE_ONLY_BACKFILL_MARKER = 'TITLE_ONLY_BACKFILL';

/** extractedData.backfillSource 값 — 라이브 관측과 분리 집계용 JSON 플래그. */
export const TITLE_BACKFILL_SOURCE = 'TITLE_ONLY';
