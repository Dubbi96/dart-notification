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

/**
 * DAR-89: QUEUE.AI_ANALYZE 잡 발행 옵션 — 재시도·DLQ 정책.
 *
 * 배경: event-extracted.consumer는 LLM 실패(429/5xx/타임아웃) 시 throw로
 * BullMQ 자동 재시도를 전제하나 정책이 없어 1회 실패 시 잡이 영구 소멸 →
 * 분석 누락(★Main Thesis A·라이브 AI 신뢰성 훼손). NOTIFY 큐와 동일 패턴 적용.
 *
 *  - attempts:3 + exponential backoff: 일시적 LLM 장애를 자동 흡수.
 *  - removeOnFail:100(보존): 소진된 실패 잡을 DLQ 대신 큐에 보존해 ai-cost
 *    health 스냅샷에서 실패 잡 수를 관측한다(테이블 추가·마이그레이션 없이).
 *  - 재시도 시 중복 LLM 비용: consumer 측 rcpNo+task 멱등 캐시로 위험 낮음.
 */
export const AI_ANALYZE_JOB_OPTIONS = {
  removeOnComplete: true,
  /** 실패 잡을 마지막 100건까지 보존(DLQ 대용) — health 관측 + 잡 유실 방지 */
  removeOnFail: 100,
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
} as const;

/** DAR-89: AI_ANALYZE 큐 상태 스냅샷(ai-cost health 관측용). Redis 미가용 시 null. */
export interface AiQueueHealth {
  /** 큐 이름(ai-analyze) */
  name: string;
  /** removeOnFail 보존분 — 재시도 소진 후 실패한 잡 수(운영 관측 핵심 지표) */
  failed: number;
  /** backoff 재시도 대기 중 잡 수(지연 큐) */
  delayed: number;
  /** 처리 중 잡 수 */
  active: number;
  /** 대기 중 잡 수 */
  waiting: number;
}

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
