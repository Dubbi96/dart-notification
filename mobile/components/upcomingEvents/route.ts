// DAR-541: 예정 이벤트 전체 화면 라우트 SSOT — 홈 섹션의 '전체 보기' 진입과
// 전용 화면(app/upcoming-events/index.tsx), 결정론 가드가 동일 상수를 참조해
// 경로 드리프트(오타·이원화)를 막는다.
export const UPCOMING_EVENTS_ROUTE = '/upcoming-events' as const;
