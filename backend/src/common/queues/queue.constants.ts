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
  /**
   * DAR-182: Expo 푸시 receipt 검증·dead-token 정리 큐(durable).
   * sendPushNotifications가 ticketId 배치를 delay 15분으로 enqueue하고,
   * ExpoReceiptConsumer가 receipt 조회+무효 토큰 정리를 단독 담당한다.
   * 휘발성 setTimeout(프로세스 메모리)을 대체해 배포·크래시·오토스케일
   * 재시작에도 receipt 처리를 보장한다(Redis 영속).
   */
  EXPO_RECEIPT: 'expo-receipt',
} as const;

/** QUEUE.AI_ANALYZE 큐 잡 이름 */
export const JOB = {
  EVENT_EXTRACTED: 'event.extracted',
} as const;

/** QUEUE.EXPO_RECEIPT 잡 이름 */
export const EXPO_RECEIPT_JOB = {
  /** ticketId 배치의 receipt 조회 + dead-token 정리 */
  CHECK: 'expo-receipt.check',
} as const;

/** Expo 권장: receipt 는 발송 후 약 15분 뒤 확인 가능 → delayed job 지연값 */
export const EXPO_RECEIPT_CHECK_DELAY_MS = 15 * 60 * 1000;

/**
 * QUEUE.EXPO_RECEIPT 잡 발행 옵션 — 재시도·보존 정책(NOTIFY 큐 패턴 재사용).
 *  - attempts:3 + exponential backoff: Expo receipt 조회 일시 장애 자동 흡수.
 *  - removeOnFail:100(보존): 소진된 실패 잡을 큐에 보존(관측·유실 방지).
 *  - delay 는 enqueue 시점에 개별 지정(EXPO_RECEIPT_CHECK_DELAY_MS).
 */
export const EXPO_RECEIPT_JOB_OPTIONS = {
  removeOnComplete: true,
  removeOnFail: 100,
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
} as const;

/** QUEUE.EXPO_RECEIPT 잡 페이로드 — receipt 검증 대상 ticket 배치 */
export interface ExpoReceiptJobData {
  /** sendPushNotifications 가 받은 status:ok ticket 의 id 와 발송 대상 토큰 쌍 */
  ticketIds: { id: string; token: string }[];
}

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

// ─── DAR-230: 자연키 기반 dedup jobId ───────────────────────────────────────
//
// 배경: AI_ANALYZE/NOTIFY/EXPO_RECEIPT 큐가 .add(name,data,options) 3-arg 로만
// 발행돼 jobId 가 없었다. AI 잡은 최소 3경로(이벤트추출 직후·reprocessMissingAi·
// 드레인)에서 같은 rcpNo 로 발행될 수 있고, jobId 가 없으면 BullMQ 가 매번 별개
// 잡을 적재한다. consumer 멱등 캐시가 LLM 비용은 막아도 큐에는 중복이 누적돼
// 워커 처리량·removeOnFail 보존 슬롯·Redis 메모리를 잠식한다.
//
// 해결: 자연키로 결정론적 jobId 를 부여한다. BullMQ 는 동일 jobId 의 잡이 큐에
// 이미 존재(대기·활성·지연·보존된 실패/완료)하면 add 를 무시(중복 미적재)하므로
// 다경로 재발행에도 큐 1건만 유지된다. removeOnComplete:true 인 happy-path 는
// 완료 즉시 잡이 제거돼 정당한 재처리(reprocess)를 막지 않는다.

/** AI_ANALYZE 잡 dedup jobId — 자연키 rcpNo 기반(`ai:<rcpNo>`). */
export const aiAnalyzeJobId = (rcpNo: string): string => `ai:${rcpNo}`;

/**
 * NOTIFY 잡 dedup jobId — 잡 유형별 자연키 기반.
 *  - SIGNAL          → `sig:<signalId>`
 *  - EXIT            → `exit:<positionId>`
 *  - THESIS_VIOLATED → `thesis:<positionThesisId>`
 * 매핑 불가한 잡 이름이면 undefined(=jobId 미부여, 종전 동작 유지).
 */
export function notifyJobId(
  jobName: string,
  data: NotifyJobData,
): string | undefined {
  switch (jobName) {
    case NOTIFY_JOB.SIGNAL:
      return `sig:${(data as NotifySignalJobData).signalId}`;
    case NOTIFY_JOB.EXIT:
      return `exit:${(data as NotifyExitJobData).positionId}`;
    case NOTIFY_JOB.THESIS_VIOLATED:
      return `thesis:${(data as NotifyThesisViolatedJobData).positionThesisId}`;
    default:
      return undefined;
  }
}

/**
 * EXPO_RECEIPT 잡 dedup jobId — 배치 첫 ticketId 기반(`rcpt:<ticketId>`).
 * ticketId 는 Expo 가 발급하는 전역 고유값이라 배치별 안정 자연키가 된다.
 * 호출부는 ticketIds 비어있을 때 enqueue 자체를 건너뛰지만, 순수 함수로서
 * 빈 배열도 안전하게 처리한다(`rcpt:empty`).
 */
export const expoReceiptJobId = (
  ticketIds: { id: string }[],
): string => `rcpt:${ticketIds[0]?.id ?? 'empty'}`;
