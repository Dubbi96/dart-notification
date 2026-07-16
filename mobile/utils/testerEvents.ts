// DAR-516 [Wave A/A6] 테스터 코호트 계측 순수 로직.
//
// 로그인 후 인앱 참여 이벤트를 backend TesterEvent(POST /ops/tester-event)로 기록한다.
// 이 파일은 RN 의존성이 없는 순수 로직만 둔다 — 전송(services/testerEvents.service.ts)과
// 유닛 테스트(__tests__/)가 함께 import 해 드리프트를 막는다.
//
// ★백엔드 미러: backend/src/ops/dto/record-tester-event.dto.ts 의 TESTER_EVENTS 와
//   정확히 일치해야 한다(계측 SSOT — 값 추가/변경 시 양쪽 동시 갱신).
// ★계측 전용 — UI/흐름 재설계 금지(측정만). 실패는 무시(fire-and-forget).
// ★PII 무수집: 이벤트명은 고정 화이트리스트뿐 — 종목/카드 식별자·자유텍스트 전송 경로 없음.

export const TESTER_EVENTS = [
  'edition_open', // 에디션 오픈(신호탭 날짜 선택 / 홈 최신 에디션 요약 노출)
  'card_tap', // 신호·에디션 카드 탭(상세 진입)
  'push_open', // 푸시 알림 탭으로 앱 진입
  'stats_section_view', // '과거 유사공시 반응' 등 통계 섹션 노출
  'waitlist_cta', // Pro waitlist(대기자) CTA 탭
  'survey_ios_shown', // iOS 게이트 설문 노출
  'survey_ios_answer_yes', // iOS 설문 응답: 관심 있음
  'survey_ios_answer_no', // iOS 설문 응답: 나중에/관심 없음
] as const;

export type TesterEvent = (typeof TESTER_EVENTS)[number];

export function isTesterEvent(value: string): value is TesterEvent {
  return (TESTER_EVENTS as readonly string[]).includes(value);
}

/** 서버 전송 페이로드 — backend RecordTesterEventDto 와 형태 일치(event 만). */
export interface TesterEventPayload {
  event: TesterEvent;
}

export function buildTesterEventPayload(event: TesterEvent): TesterEventPayload {
  return { event };
}
