// 파이프라인 폐루프 관측·재처리 타입 (DAR-126).
// 수집(Disclosure)→파싱(DisclosureDocument)→이벤트(DisclosureEvent)→AI(DisclosureAnalysis)
// 단계 전이를 read-only 집계로 가시화하고, 누락분 backfill 결과를 보고한다.
// AI 미개입(집계는 순수 DB 카운트), 신규 외부호출 0, 스키마 변경 0.

/** 단계별 실패/지연 행 1건(가시화용, 비밀값 없음). */
export interface PipelineFailureRow {
  /** 'PARSE' | 'EVENT' */
  stage: 'PARSE' | 'EVENT';
  rcpNo: string;
  /** 해당 단계의 상태 문자열(ParseStatus 또는 ExtractionStatus). */
  status: string;
  /** 실패 사유/마지막 오류(있으면). */
  detail: string | null;
  /** 재시도 누적 횟수(파싱 단계만, 이벤트는 null). */
  retryCount: number | null;
  /** 해당 행의 최종 갱신 시각 ISO8601. */
  at: string | null;
}

/** 수집 단계 카운터. */
export interface CollectionStageCounters {
  /** 누적 공시 수 */
  total: number;
  /** 최근 24시간 수집 공시 수 */
  last24h: number;
  /** 파싱 문서 레코드가 아직 없는 공시 수(파싱 큐 미등록 = 누락 후보) */
  missingDocument: number;
}

/** 파싱 단계 카운터(ParseStatus 분포 + 지연). */
export interface ParseStageCounters {
  pending: number;
  fetching: number;
  parsing: number;
  done: number;
  fetchFailed: number;
  parseFailed: number;
  skipped: number;
  /** 재처리 가능(FETCH_FAILED|PARSE_FAILED & retryCount<MAX) 건수 */
  retryable: number;
  /** 가장 오래된 PENDING 문서의 적체 시간(분). PENDING 없으면 null. */
  oldestPendingAgeMinutes: number | null;
}

/** 이벤트 단계 카운터(ExtractionStatus 분포 + 누락/지연). */
export interface EventStageCounters {
  pending: number;
  success: number;
  failed: number;
  needsReview: number;
  /** 파싱 DONE 이지만 이벤트 레코드가 없는 건수(이벤트 추출 누락 후보) */
  missingForParsedDocs: number;
  /** 가장 오래된 PENDING 이벤트의 적체 시간(분). PENDING 없으면 null. */
  oldestPendingAgeMinutes: number | null;
}

/** AI 단계 카운터(요약 분석 도달률 관측 — re-enqueue는 별도 수동 경로). */
export interface AiStageCounters {
  /** AI 분석 자격 이벤트(SUCCESS|NEEDS_REVIEW) 수 — 큐 발행 대상 */
  eligibleEvents: number;
  /** summary 분석(DisclosureAnalysis task=summary)이 적재된 공시 수 */
  summarized: number;
  /**
   * 자격 이벤트 중 summary 분석이 아직 없는 건수.
   * ★주의: AI 비용게이트 L0(저거래대금 등)로 정당하게 스킵된 건도 포함된다 —
   *   "미발화"와 "정당 스킵"을 DB만으로 구분할 수 없으므로 관측치로만 노출하고,
   *   cron 자동 재발행은 하지 않는다(무한 재시도·노이즈 방지). 운영자 수동 재처리 경로 제공.
   */
  awaitingSummary: number;
}

/** 파이프라인 폐루프 헬스 스냅샷(read-only 집계). */
export interface PipelineHealth {
  /** 집계 생성 시각 ISO8601 */
  generatedAt: string;
  collection: CollectionStageCounters;
  parsing: ParseStageCounters;
  events: EventStageCounters;
  ai: AiStageCounters;
  /** 단계별 실패/적체 최근 행(상위 N건, 가시화용) */
  recentFailures: PipelineFailureRow[];
}

/** 폐루프 backfill 1회 실행 결과(멱등). */
export interface PipelineDrainResult {
  /** 파싱 큐에 신규 등록한 누락 공시 수(missingDocument backfill) */
  enqueuedMissingDocuments: number;
  /** 파싱 배치: 성공/실패 */
  parse: { success: number; failed: number };
  /** 이벤트 배치: 성공/실패/검토대기 */
  events: { success: number; failed: number; needsReview: number };
  /** 총 소요(ms) */
  durationMs: number;
}

/** AI 재발행(수동 전용) 결과. */
export interface AiReprocessResult {
  /** 재발행 대상으로 스캔한 자격 이벤트 수 */
  scanned: number;
  /** 큐에 재발행한 건수(summary 미존재만). 큐 미가용 시 0. */
  reEnqueued: number;
}
