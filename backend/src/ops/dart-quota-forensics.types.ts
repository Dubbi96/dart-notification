/**
 * dart-quota-forensics.types.ts — DART 야간 쿼터 소진 포렌식 리포트 타입 (DAR-536)
 *
 * DAR-532(재기동 시 쿼터 상태 영속화, PR #513)의 후속 — prod DB 직접 접근 대신
 * 읽기 전용 ops 진단 엔드포인트(edition-density 패턴 동형)로 야간(00:00~08:29 KST)
 * DART 쿼터 소비 경로를 정량 분해하고 'DAR-532 다중 재기동 예산 재개방' 가설을 판정한다.
 * 정본: DAR-536 이슈 + PM 재정의 코멘트(2026-07-17).
 */

/** 야간 감사 창(KST) — 자정 쿼터 리셋 직후 ~ 장전(08:30 프리플라이트) 직전. */
export const NIGHT_WINDOW_KST = { startKst: '00:00', endKst: '08:29' } as const;

/**
 * list.json 페이지 크기 — dart-api.service getDisclosureList*(page_count=100)와 동일.
 * 수집 로그의 fetchedCount 로 list 콜 수를 추정하는 데 쓴다(1페이지=1콜, 최소 1콜).
 */
export const DART_LIST_PAGE_SIZE = 100;

/**
 * 소비 경로 키 — DAR-536 이슈가 지목한 후보 경로 전부(정직성: 구조적으로 DART 소비가
 * 0 인 TABLES_LAZY_FETCH 도 명시 포함해 '왜 0 인지'를 리포트가 직접 말하게 한다).
 */
export type DartForensicsPathKey =
  | 'LIST_FORWARD' // 라이브/오프아워/델타 목록 수집(list.json, triggeredBy CRON|MANUAL)
  | 'LIST_BACKFILL_EXTEND' // 고대 백필 목록 확장(list.json, triggeredBy BACKFILL_EXTEND)
  | 'DOC_FETCH_LIVE' // 라이브(비백필) 공시 문서 원문 fetch(document.xml)
  | 'DOC_FETCH_BACKFILL' // 백필 공시 문서 원문 fetch(document.xml)
  | 'FINANCIALS' // 재무 재수화(fnlttSinglAcntAll, 1콜/기업·연도·보고서·fsDiv)
  | 'INSIDER_HOLDINGS' // 지분·내부자(majorstock/elestock, 2콜/스캔 종목)
  | 'TABLES_LAZY_FETCH'; // tables lazy fetch — S3/객체 스토리지 전용, DART 소비 0(구조적)

/** 경로 키 고정 순서(리포트 행 순서 안정화). */
export const DART_FORENSICS_PATHS: readonly DartForensicsPathKey[] = [
  'LIST_FORWARD',
  'LIST_BACKFILL_EXTEND',
  'DOC_FETCH_LIVE',
  'DOC_FETCH_BACKFILL',
  'FINANCIALS',
  'INSIDER_HOLDINGS',
  'TABLES_LAZY_FETCH',
] as const;

/** 경로별 한국어 라벨(운영 가독). */
export const DART_FORENSICS_PATH_LABELS: Record<DartForensicsPathKey, string> = {
  LIST_FORWARD: '벌크 list — forward(라이브/오프아워/델타)',
  LIST_BACKFILL_EXTEND: '벌크 list — 고대 백필 확장(BACKFILL_EXTEND)',
  DOC_FETCH_LIVE: '문서 파싱 fetch — 라이브(비백필)',
  DOC_FETCH_BACKFILL: '문서 파싱 fetch — 백필',
  FINANCIALS: '재무 재수화(fnlttSinglAcntAll)',
  INSIDER_HOLDINGS: '지분·내부자(majorstock/elestock)',
  TABLES_LAZY_FETCH: 'tables lazy fetch(S3 — DART 소비 0)',
};

/**
 * 크론 타임라인에 노출할 잡 키(cron_run_logs.jobKey) — DART 유관 여부 태깅.
 * dartRelevant=false 잡(제목백필·오프로드·AI백필)은 'DART 0콜 경로가 야간에 돌았다'는
 * 반증 컨텍스트로 동봉한다(PM 이 tables lazy fetch 소비 0 을 로그로 확인 가능).
 */
export const DART_FORENSICS_TIMELINE_JOBS: Record<string, { dartRelevant: boolean }> = {
  'pipeline.drain': { dartRelevant: true },
  'parse.retry': { dartRelevant: true },
  'event.backfill-drain': { dartRelevant: true },
  'disclosure.backfill-extend': { dartRelevant: true },
  'insider.daily': { dartRelevant: true },
  'financial.collect': { dartRelevant: true },
  'disclosure.delta': { dartRelevant: true },
  'disclosure.intraday': { dartRelevant: true },
  'event.title-backfill': { dartRelevant: false },
  'rawtext.offload-drain': { dartRelevant: false },
  'tables.offload-drain': { dartRelevant: false },
  'ai.backfill-drain': { dartRelevant: false },
};

/**
 * 재기동 마커 판정 유예(ms) — startedAt 이 이보다 최근인 RUNNING 행은 '지금 실제로
 * 실행 중'일 수 있어 마커에서 제외한다(드레인 최장 타임아웃 10분의 3배 보수 마진).
 */
export const RESTART_MARKER_GRACE_MS = 30 * 60 * 1000;

/** DART 3단 예산 계층 스냅샷(dart-api.service SSOT 상수 동봉 — 판정 근거 정직 고지). */
export interface DartBudgetTiers {
  /** 일일 총예산(19,000 — 무료키 20,000 아래 보수 상한). */
  dailyBudget: number;
  /** 라이브 목록수집 전용 예약분(2,000). */
  liveReserve: number;
  /** 라이브 문서 fetch 전용 예약분(3,000). */
  liveParseReserve: number;
  /** 라이브 문서 fetch 누적 상한(17,000). */
  liveParseCeiling: number;
  /** 벌크(문서/백필/재무) 누적 상한(14,000). */
  bulkCeiling: number;
  /** DAR-532 쿼터 영속화 flush 스텝(200콜) — callsToday 저평가 최대폭. */
  persistStep: number;
}

/** dart_quota_state 당일 스냅샷(DAR-532 배포 이후 일자만 행 존재). */
export interface QuotaStateSnapshot {
  /** 해당 일자 행 존재 여부. false = DAR-532 배포 전 일자이거나 미기록. */
  found: boolean;
  /** 영속화된 당일 누적 콜(스로틀 flush — 실소비 이하 하한). 행 없으면 null. */
  callsToday: number | null;
  /** 실제 020/021 관측 여부. 행 없으면 null. */
  quotaExhausted: boolean | null;
  /** 마지막 flush 시각(KST 'YYYY-MM-DD HH:mm:ss'). 행 없으면 null. */
  updatedAtKst: string | null;
  /** 해석 주의사항(존재 시점·저평가 폭). */
  note: string;
}

/** 소비 경로 1행 — 야간 창 정량. */
export interface PathSummary {
  path: DartForensicsPathKey;
  label: string;
  /** 야간 창 추정 DART 콜 수(하한 — 재시도/무저장 콜 미관측). */
  estimatedCalls: number;
  /** 산출 근거(어느 테이블·어떤 규칙으로 추정했는지 — 정직성 계약). */
  evidence: string;
}

/** 야간 창(00:00~08:29 KST) 요약. */
export interface NightWindowSummary {
  /** 창 내 전 경로 추정 콜 합(하한). */
  totalEstimatedCalls: number;
  /** 전 경로 정량(0 포함, 고정 순서). */
  paths: PathSummary[];
  /** 소비 상위 경로(0 제외, 최대 3 — DoD '상위 경로 3건 정량'). */
  topPaths: PathSummary[];
}

/** 시간대별 1행(해당 KST 일자 00~23시 — 야간 창 밖은 주간 대조 컨텍스트). */
export interface ForensicsHourlyRow {
  /** KST 시(hour) '00'~'23'. */
  hour: string;
  /** 해당 시간대 전 경로 추정 콜 합. */
  total: number;
  /** 경로별 추정 콜. */
  byPath: Record<DartForensicsPathKey, number>;
}

/** 크론 실행 타임라인 1행(cron_run_logs, 당일·선별 잡만). */
export interface CronTimelineEntry {
  jobKey: string;
  startedAtKst: string;
  finishedAtKst: string | null;
  status: string;
  itemCount: number;
  /** true = DART 콜을 발생시킬 수 있는 잡 / false = DART 0콜 잡(반증 컨텍스트). */
  dartRelevant: boolean;
}

/** 목록 수집 실행 1행(disclosure_collection_logs 원자료 — 감사 추적). */
export interface CollectionRunEntry {
  startedAtKst: string;
  endedAtKst: string | null;
  /** 수집 구간(YYYYMMDD). bgnDe<endDe 광구간 = 백필성 스캔. */
  bgnDe: string;
  endDe: string;
  triggeredBy: string;
  status: string;
  fetchedCount: number;
  /** 추정 list 콜 = max(1, ceil(fetchedCount/100)). */
  estimatedListCalls: number;
}

/** 재기동 마커 1건 — 프로세스 사망 중단 흔적(RUNNING 고착·종료시각 null). */
export interface RestartMarker {
  source: 'disclosure_collection_logs' | 'cron_run_logs' | 'financial_collection_logs';
  /** 식별자(jobKey 또는 수집구간 bgnDe~endDe). */
  key: string;
  startedAtKst: string;
  note: string;
}

/** 재기동 마커 리포트. */
export interface RestartMarkerReport {
  count: number;
  markers: RestartMarker[];
  /** 마커 의미·한계(하한, 정상 행(hang)과의 구별 유예) 고지. */
  note: string;
}

/** 가설 판정. */
export type ForensicsVerdict = 'SUPPORTED' | 'REFUTED' | 'INCONCLUSIVE';

/** DAR-532 '다중 재기동 예산 재개방' 가설 판정 블록. */
export interface HypothesisVerdictReport {
  /** 판정 대상 가설 문언(고정). */
  hypothesis: string;
  verdict: ForensicsVerdict;
  /** 야간 창 추정 콜 합(하한). */
  nightEstimatedCalls: number;
  /** 단일 프로세스 벌크 상한(대조 기준). */
  bulkCeiling: number;
  /** nightEstimatedCalls / bulkCeiling (소수 2자리). >1 = 단일 예산으로 설명 불가. */
  budgetOverrunFactor: number;
  restartMarkerCount: number;
  /** 판정 근거(정량 문장 배열). */
  reasons: string[];
  /** 판정 스코프 한정(조회 일자 1일 한정 — 사건 일자를 조회해야 유의미). */
  note: string;
}

/** 최상위 리포트. */
export interface DartQuotaForensicsReport {
  metric: 'dart-quota-forensics';
  /** 감사 대상 KST 일자(YYYYMMDD). */
  date: string;
  generatedAt: string;
  nightWindow: { startKst: string; endKst: string };
  budget: DartBudgetTiers;
  quotaState: QuotaStateSnapshot;
  night: NightWindowSummary;
  hourly: ForensicsHourlyRow[];
  cronTimeline: CronTimelineEntry[];
  collectionRuns: CollectionRunEntry[];
  restartMarkers: RestartMarkerReport;
  hypothesis: HypothesisVerdictReport;
  /** 추정 한계 정직 고지(하한 추정·미관측 콜 유형 등). */
  caveats: string[];
}
