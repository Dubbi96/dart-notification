/** BullMQ 큐 이름 상수 — Engine 간 비동기 메시지 전달 */
export const QUEUE = {
  /** Engine1→Engine2: 이벤트 추출 완료 → AI 분석 트리거 */
  AI_ANALYZE: 'ai-analyze',
  /**
   * DAR-85: 신호·청산·논리훼손 통지 큐.
   * 엔진(3 신호생성 / 4 논리훼손 / 5 청산)은 이 큐로만 enqueue 하고,
   * 발송·인박스 기록은 NotifyConsumer가 단독 담당한다(엔진 직접 발송 금지).
   */
  NOTIFY: 'notify',
} as const;

/** QUEUE.AI_ANALYZE 큐 잡 이름 */
export const JOB = {
  EVENT_EXTRACTED: 'event.extracted',
} as const;

/** QUEUE.NOTIFY 잡 이름 — NotificationType과 1:1 대응 */
export const NOTIFY_JOB = {
  /** engine3 매수신호(STRONG_BUY/BUY) */
  SIGNAL: 'notify.signal',
  /** engine5 청산 권고(EXIT/BLOCK_REBUY) */
  EXIT: 'notify.exit',
  /** engine4 투자논리 훼손(ACTIVE→INVALIDATED) */
  THESIS_VIOLATED: 'notify.thesis-violated',
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

/** NOTIFY_JOB.SIGNAL 페이로드 — engine3 TradingSignal 영속 직후 발행 */
export interface NotifySignalJobData {
  signalId: string;
  corpCode: string;
  stockCode?: string;
  corpName?: string;
  eventType?: string;
  buyScore?: number;
  /** SignalGrade enum 값(STRONG_BUY/BUY/…) */
  grade?: string;
}

/** NOTIFY_JOB.EXIT 페이로드 — engine5 청산 권고 시점 발행 */
export interface NotifyExitJobData {
  positionId: string;
  corpCode: string;
  stockCode?: string;
  corpName?: string;
  /** ExitScore.exitAction(EXIT/BLOCK_REBUY 등) */
  exitAction?: string;
  /** 발동 트리거 유형(STOP_LOSS 등) */
  triggerTypes?: string[];
}

/** NOTIFY_JOB.THESIS_VIOLATED 페이로드 — engine4 invalidate 직후 발행 */
export interface NotifyThesisViolatedJobData {
  positionThesisId: string;
  corpCode: string;
  stockCode?: string;
  corpName?: string;
  /** 훼손 근거 요약(선택) */
  reason?: string;
}

export type NotifyJobData =
  | NotifySignalJobData
  | NotifyExitJobData
  | NotifyThesisViolatedJobData;
