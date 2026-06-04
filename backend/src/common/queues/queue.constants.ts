/** BullMQ 큐 이름 상수 — Engine 간 비동기 메시지 전달 */
export const QUEUE = {
  /** Engine1→Engine2: 이벤트 추출 완료 → AI 분석 트리거 */
  AI_ANALYZE: 'ai-analyze',
} as const;

/** QUEUE.AI_ANALYZE 큐 잡 이름 */
export const JOB = {
  EVENT_EXTRACTED: 'event.extracted',
} as const;

/** QUEUE.AI_ANALYZE 잡 페이로드 */
export interface AiAnalyzeJobData {
  rcpNo: string;
  corpCode: string;
  eventType: string;
  polarity: string;
  confidence: number;
  isAiAssisted: boolean;
}
