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
  /** DAR-424 engine5 라이브 페이퍼 매수 체결(분봉 단타·시스템 모의) */
  TRADE_ENTRY: 'notify.trade-entry',
  /** DAR-424 engine5 라이브 페이퍼 매도 체결(손익% 포함) */
  TRADE_EXIT: 'notify.trade-exit',
  /** DAR-473(P01) 리스크·운영 알림(RISK_ALERT/OPS_ALERT) — 감지점/운영 리포트가 발행 */
  OPS_ALERT: 'notify.ops-alert',
  /** 갭분석 W7: 관심종목 급변동(전일 대비 ±5%) — engine3 price-move-alert 5분 틱이 발행 */
  PRICE_MOVE: 'notify.price-move',
  /** DAR-523(Wave B/B2): 일일 에디션 발행 푸시 — engine3 edition-push 19:05 크론이 발행(빈 에디션 미발행) */
  EDITION: 'notify.edition',
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

/**
 * DAR-424: NOTIFY_JOB.TRADE_ENTRY / TRADE_EXIT 페이로드 — engine5 라이브 페이퍼 체결 직후 발행.
 *
 * ★시스템 모의/분봉 단타는 전역(단일) 시뮬이므로 체결 시점의 포트폴리오 스냅샷(현금·평가금)을
 *   발행 측이 산출해 페이로드에 담는다(consumer 가 시점 상태를 재계산하지 않는다 — point-in-time 보존).
 * ★수신자는 포지션 소유자(합성 시스템 유저)가 아니라 실제 앱 사용자 전원(브로드캐스트)이다.
 *   consumer 가 tradePushEnabled(기본 ON) 토글로 인박스·푸시를 게이트한다.
 * ★알림은 통지일 뿐 — 주문 결정/실주문과 무관(AI 금지영역 불침범).
 */
export interface NotifyTradeJobData {
  /** 'ENTRY' = 매수 체결, 'EXIT' = 매도 체결 */
  kind: 'ENTRY' | 'EXIT';
  /**
   * 장외 체결 의미론(2026-07, ENTRY 전용): 'RESERVED' = 주문 예약(익일 시가 체결 예정),
   * 'FILLED' = 당일 시가 체결. additive optional — 미지정(레거시 발행자·기존 소비자)은
   * 종전 '체결' 의미로 동작(호환 유지).
   */
  phase?: 'RESERVED' | 'FILLED';
  /** 멱등 자연키 — 체결 단위 식별(분봉 단타 trade id / 시스템 모의 position id). */
  refId: string;
  /** 트랙 식별 키(딥링크·data 페이로드용). 예: 'intraday-scalp' | 'paper-simulation' */
  strategyKey: string;
  /** 사용자 표시 트랙 라벨. 예: '분봉 단타' | '시스템 모의' */
  strategyLabel: string;
  corpCode: string;
  stockCode: string;
  /** 종목명(없으면 stockCode 폴백을 발행 측이 적용). */
  corpName: string;
  /** 체결가(매수=진입 체결가 / 매도=청산 체결가, KRW). */
  price: number;
  /** 체결 수량(주). */
  shares: number;
  /** 매도 순수익률(%). 매수면 생략. */
  pnlPct?: number;
  /** 매도 사유 태그(TAKE_PROFIT/STOP_LOSS/FORCE_CLOSE_EOD 등). 매수면 생략. */
  exitReason?: string;
  /** 체결 직후 현금 잔액(KRW). */
  cash: number;
  /** 체결 직후 전체 평가금(보유 평가합 + 현금, KRW). */
  totalValue: number;
  /** 인앱 딥링크(해당 전략/단타 화면). */
  deepLink: string;
}

/**
 * DAR-473(P01): 리스크·운영 알림 심각도. 푸시 제목의 심각도 라벨·(향후) 채널 중요도 라우팅용.
 * 순서(오름차순): INFO < WARNING < ERROR < CRITICAL.
 */
export type OpsAlertSeverity = 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

/**
 * DAR-473(P01): NOTIFY_JOB.OPS_ALERT 페이로드 — 리스크·운영 알림(RISK_ALERT/OPS_ALERT).
 *
 * ★관측·알림 계층 전용 — 주문 결정/실주문과 무관(AI 금지영역·M10 클록 불침범).
 * 수신자는 실제 앱 사용자 전원(브로드캐스트)이며 consumer 가 opsPushEnabled(기본 ON) 토글로
 * 인박스·푸시를 게이트한다(체결 알림과 동일 브로드캐스트 배선 재사용).
 *
 * type 으로 RISK_ALERT/OPS_ALERT 를 구분한다(카테고리는 둘 다 'system'):
 *  - OPS_ALERT  : enqueueOpsAlert 가 발행(P05 일일 리포트·수집/청산 실패 등).
 *  - RISK_ALERT : P02 감지점 배선(킬스위치 발동·드로다운 컷)이 발행 — 채널은 본 이슈가 신설.
 */
export interface NotifyOpsAlertJobData {
  /** 알림 타입 — 운영(OPS_ALERT) 또는 리스크(RISK_ALERT). */
  type: 'OPS_ALERT' | 'RISK_ALERT';
  /** 심각도(제목 라벨·중요도). */
  severity: OpsAlertSeverity;
  /** 발행 출처(감지점 식별 키). 예: 'kill-switch' | 'cron-freshness' | 'daily-report'. */
  source: string;
  /** 사용자 표시 본문(한국어). */
  message: string;
  /**
   * 멱등 자연키 — 동일 사건 중복 억제(NotificationHistory unique + BullMQ jobId).
   * 반복 발화 이벤트(예: 매일 크론 stale)는 시간 버킷을 포함해야 한다(예: 'cron-stale:2026-07-03').
   */
  dedupeKey: string;
  /** 인앱 딥링크(선택). 없으면 알림 탭 기본 진입. */
  deepLink?: string;
  /** 부가 메타(수치·컨텍스트 등, 선택) — 인박스/푸시 표시엔 미사용(관측용). */
  meta?: Record<string, unknown>;
}

/**
 * 갭분석 W7: NOTIFY_JOB.PRICE_MOVE 페이로드 — 관심종목 급변동 알림.
 *
 * ★조회·계측·알림 계층 전용 — 매매·체결·Buy Score 경로와 무접점(M10 모의운용 무오염·AI 0).
 * 발행자(engine3 PriceMoveAlertService)가 제목·본문·팩트체크(당일 공시 유무 병기, W6)를
 * 완성해 싣고, consumer 는 수신자 해석(해당 종목 watcher)·설정 게이트(priceMovePushEnabled,
 * ★기본 OFF — OFF 면 인박스도 생략)·멱등 인박스·푸시만 담당한다.
 * 멱등: refId = `<stockCode>-<YYYYMMDD>`(종목당 1일 1회) — NotificationHistory unique + jobId 공유.
 */
export interface NotifyPriceMoveJobData {
  /** 멱등 자연키 — `<stockCode>-<YYYYMMDD>` (종목당 1일 1회 dedupe). */
  refId: string;
  corpCode: string;
  stockCode: string;
  corpName: string;
  /** 발화 거래일(KST YYYYMMDD). */
  tradeDate: string;
  /** 전일 종가 대비 등락률(%). */
  changePct: number;
  /** 현재가(KIS inquire-price, KRW). */
  price: number;
  /** 전일 종가(StockDailyPrice, KRW). */
  prevClose: number;
  /** 완성된 알림 제목(발행 측 산출 — point-in-time 보존). */
  title: string;
  /** 완성된 알림 본문(당일 공시 유무·무공시 팩트체크 근거 병기). */
  body: string;
  /** 인앱 딥링크 — 종목 상세(`/company/<corpCode>`). */
  deepLink: string;
  /** 네이버금융 종목 뉴스 링크아웃 URL(외부 브라우저 전용 — 수집·저장 0). */
  newsUrl?: string;
}

/**
 * DAR-523(Wave B/B2·P0): NOTIFY_JOB.EDITION 페이로드 — 일일 투자판단 에디션 발행 푸시.
 *
 * ★조회·알림 계층 전용 — engine5(매매·체결)·Buy Score 경로 무접점(M10 무오염·AI 0).
 * 발행자(engine3 EditionPublishPushScheduler 19:05)가 당일(KST) 에디션을 조회 API 재사용으로
 * 가져와 ★빈 에디션(매수등급 0)은 애초에 enqueue 하지 않는다(하드 가드). 실린 count 는 항상 >0.
 * 수신자는 실제 앱 사용자 전원(브로드캐스트)이며 consumer 가 editionPushEnabled(★기본 OFF — OFF 면
 * 인박스도 생략) 게이트·멱등 인박스·일일 캡을 담당한다.
 * 멱등: refId = editionDate(YYYYMMDD·KST) — 사용자당 에디션 1호 1회(NotificationHistory unique +
 * push_delivery_log unique + BullMQ jobId 공유 → 재기동/재시도에도 중복 발송 0).
 */
export interface NotifyEditionJobData {
  /** 멱등 자연키 — KST 에디션 발행일 YYYYMMDD(사용자당 1호 1회). */
  editionDate: string;
  /** 매수등급(STRONG_BUY+BUY) 총 건수. ★하드 가드 불변식: >0 이어야 발행(빈 에디션 미발송). */
  count: number;
  /** 적극매수(STRONG_BUY) 건수(본문 표기용). */
  strongBuyCount: number;
  /** 헤드라인 기업명(최고 점수 종목 — 본문 표기용). */
  headlineCorpName: string;
  /** 완성된 푸시 제목(발행 측 산출 — point-in-time 보존). */
  title: string;
  /** 완성된 푸시 본문(매수 후보 수·헤드라인 — 정직 팩트, 권고 문구 아님). */
  body: string;
  /** 인앱 딥링크 — 신호탭 에디션 브라우징(`/signals`). */
  deepLink: string;
}

export type NotifyJobData =
  | NotifySignalJobData
  | NotifyExitJobData
  | NotifyThesisViolatedJobData
  | NotifyTradeJobData
  | NotifyOpsAlertJobData
  | NotifyPriceMoveJobData
  | NotifyEditionJobData;

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

// 구분자는 '-' 를 쓴다. BullMQ 4+/Redis 는 custom jobId 에 ':' 를 허용하지 않아
// (`Error: Custom Id cannot contain :`) ':' 를 쓰면 add 자체가 throw 돼 잡이
// 적재되지 않는다(이벤트추출→AI→신호→알림 파이프라인 전면 실패). '-' 는 안전
// 문자이며, 접두사·자연키가 그대로라 dedup 결정성(동일 키→동일 jobId)은 보존된다.

/** AI_ANALYZE 잡 dedup jobId — 자연키 rcpNo 기반(`ai-<rcpNo>`). */
export const aiAnalyzeJobId = (rcpNo: string): string => `ai-${rcpNo}`;

/**
 * NOTIFY 잡 dedup jobId — 잡 유형별 자연키 기반.
 *  - SIGNAL          → `sig-<signalId>`
 *  - EXIT            → `exit-<positionId>`
 *  - THESIS_VIOLATED → `thesis-<positionThesisId>`
 * 매핑 불가한 잡 이름이면 undefined(=jobId 미부여, 종전 동작 유지).
 */
export function notifyJobId(
  jobName: string,
  data: NotifyJobData,
): string | undefined {
  switch (jobName) {
    case NOTIFY_JOB.SIGNAL:
      return `sig-${(data as NotifySignalJobData).signalId}`;
    case NOTIFY_JOB.EXIT:
      return `exit-${(data as NotifyExitJobData).positionId}`;
    case NOTIFY_JOB.THESIS_VIOLATED:
      return `thesis-${(data as NotifyThesisViolatedJobData).positionThesisId}`;
    // DAR-424: 체결 단위 자연키 — 매수/매도를 분리(같은 refId 라도 kind 가 달라 별개 잡).
    case NOTIFY_JOB.TRADE_ENTRY:
      return `trade-entry-${(data as NotifyTradeJobData).refId}`;
    case NOTIFY_JOB.TRADE_EXIT:
      return `trade-exit-${(data as NotifyTradeJobData).refId}`;
    // DAR-473(P01): 리스크/운영 알림 — dedupeKey 자연키. type 을 접두사에 실어
    //   같은 dedupeKey 라도 RISK/OPS 는 별개 잡. ★BullMQ custom jobId 는 ':' 불가 →
    //   dedupeKey 의 ':'(시간버킷 구분자 등)를 '-' 로 치환한다(dedup 결정성 보존).
    case NOTIFY_JOB.OPS_ALERT: {
      const d = data as NotifyOpsAlertJobData;
      const prefix = d.type === 'RISK_ALERT' ? 'risk' : 'ops';
      return `${prefix}-${d.dedupeKey.replace(/:/g, '-')}`;
    }
    // 갭분석 W7: 급변동 — refId(`<stockCode>-<YYYYMMDD>`) 자연키로 종목당 1일 1잡(':' 미포함).
    case NOTIFY_JOB.PRICE_MOVE:
      return `pmove-${(data as NotifyPriceMoveJobData).refId}`;
    // DAR-523: 에디션 발행 — editionDate(YYYYMMDD) 자연키로 하루 1잡(재기동/재시도 중복 적재 방지·':' 미포함).
    case NOTIFY_JOB.EDITION:
      return `edition-${(data as NotifyEditionJobData).editionDate}`;
    default:
      return undefined;
  }
}

/**
 * EXPO_RECEIPT 잡 dedup jobId — 배치 첫 ticketId 기반(`rcpt-<ticketId>`).
 * ticketId 는 Expo 가 발급하는 전역 고유값이라 배치별 안정 자연키가 된다.
 * 호출부는 ticketIds 비어있을 때 enqueue 자체를 건너뛰지만, 순수 함수로서
 * 빈 배열도 안전하게 처리한다(`rcpt-empty`).
 */
export const expoReceiptJobId = (
  ticketIds: { id: string }[],
): string => `rcpt-${ticketIds[0]?.id ?? 'empty'}`;
