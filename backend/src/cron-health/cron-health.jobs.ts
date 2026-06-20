// 모니터링 대상 크론 잡 레지스트리 (DAR-110) — 단일 출처.
// 잡 키는 CronRunRecorder(기록)와 DataFreshnessService(판정)에서 공유한다.

import { FreshnessJobSpec } from './freshness';

/**
 * CronRunLog 에 자체 기록하는 잡(=기존 도메인 *CollectionLog 가 없던 경량 크론)의 키.
 * 값 변경 시 freshness 사양과 스케줄러 래핑이 함께 깨지지 않도록 한 곳에서만 관리.
 */
export const CRON_JOB_KEYS = {
  SIGNAL_GENERATE: 'signal.generate',
  PAPER_SIMULATION: 'paper.simulation',
  INSIDER_DAILY: 'insider.daily',
  PARSE_RETRY: 'parse.retry',
  PIPELINE_DRAIN: 'pipeline.drain',
  EVENT_STUDY_CALC: 'event-study.calculate',
  // DAR-232: 그간 CronRunRecorder 로 감싸지지 않아 실패가 로그로만 삼켜지던 경량 크론.
  CLEANUP_DAILY: 'cleanup.daily', // 자정 만료 토큰/알림 정리
  KIS_REALTIME: 'kis.realtime-poll', // 장중 실시간 현재가 폴링
  // DAR-347: FAILED 이벤트 자동복구 — reprocess 경로를 주기 호출해 사일런트 손실 방지.
  FAILED_EVENT_RECOVERY: 'failed-event.recovery',
  // DAR-366: 장중 손절 모니터 — 보유종목 실시간 능동 fetch 후 Exit 평가(실가 -8% 손절 발화 유일 경로).
  INTRADAY_EXIT_MONITOR: 'paper.intraday-exit',
  // DAR-377: 분봉 수집 — KIS 당일 분봉을 StockMinutePrice 에 forward 축적(장중 공시반응 분석 기반).
  MINUTE_PRICE_COLLECT: 'market.minute-collect',
  // DAR-379: AI 평가 백필 드레인 — 과거 미분석 공시를 비용게이트 내 점진 드레인(평가자료 코퍼스 적재).
  AI_BACKFILL_DRAIN: 'ai.backfill-drain',
  // DAR-391: 이벤트 추출 백필 드레인 — 과거 백필 공시를 rcpDt 시간순 추출/파싱등록(신호·백테스트 연중화 게이트).
  EVENT_BACKFILL_DRAIN: 'event.backfill-drain',
  // DAR-395: rawText 객체 스토리지 오프로드 드레인 — 과거 원문을 S3/로컬로 이전 후 DB 컬럼 비움(경량화).
  RAWTEXT_OFFLOAD_DRAIN: 'rawtext.offload-drain',
} as const;

export type CronJobKey = (typeof CRON_JOB_KEYS)[keyof typeof CRON_JOB_KEYS];

// 도메인 *CollectionLog 에서 신선도를 읽는 잡의 식별 키(테이블 매핑은 서비스가 처리).
export const DOMAIN_JOB_KEYS = {
  DISCLOSURE_INTRADAY: 'disclosure.intraday',
  KRX_DAILY: 'krx.daily',
  FINANCIAL: 'financial.collect',
} as const;

// 일 단위 평일 크론의 허용 경과시간 — 정상 주말(금요일 성공 → 월요일 평가 ≈ 72h)을
// 흡수하도록 넉넉히. 그 이상 비면 '여러 날 조용히 멈춤'으로 보고 stale.
const WEEKDAY_DAILY_STALE_MIN = 4_320; // 72시간

/**
 * 신선도 판정 사양 — 도메인 로그 기반 3건 + CronRunLog 기반 4건.
 * staleAfterMinutes 는 카덴스 + 주말/공휴일 공백을 고려한 운영 임계치.
 */
export const FRESHNESS_JOB_SPECS: FreshnessJobSpec[] = [
  {
    jobKey: DOMAIN_JOB_KEYS.DISCLOSURE_INTRADAY,
    label: '공시 장중 폴링',
    source: 'DISCLOSURE_LOG',
    window: 'WEEKDAY_INTRADAY',
    staleAfterMinutes: 30, // 10분 간격 폴링 — 30분 무수집이면 정체
    cadence: '평일 08:00~18:00 / 10분 간격',
  },
  {
    jobKey: DOMAIN_JOB_KEYS.KRX_DAILY,
    label: 'KRX 일봉·지수 수집',
    source: 'MARKET_DATA_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: WEEKDAY_DAILY_STALE_MIN,
    cadence: '평일 18:30 EOD',
  },
  {
    jobKey: DOMAIN_JOB_KEYS.FINANCIAL,
    label: '재무제표 수집',
    source: 'FINANCIAL_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: 14_400, // 10일 — 주간/분기 카덴스 + 공백 흡수
    cadence: '주간(월) + 분기 백필',
  },
  {
    jobKey: CRON_JOB_KEYS.SIGNAL_GENERATE,
    label: '매수 신호 생성',
    source: 'CRON_RUN_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: WEEKDAY_DAILY_STALE_MIN,
    cadence: '평일 19:00',
  },
  {
    jobKey: CRON_JOB_KEYS.PAPER_SIMULATION,
    label: '모의운용 일일 사이클',
    source: 'CRON_RUN_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: WEEKDAY_DAILY_STALE_MIN,
    cadence: '평일 19:30',
  },
  {
    jobKey: CRON_JOB_KEYS.INSIDER_DAILY,
    label: '내부자·대량보유 지분변동',
    source: 'CRON_RUN_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: 2_880, // 48시간 — 매일 03:30, 하루 누락까지 허용
    cadence: '매일 03:30',
  },
  {
    jobKey: CRON_JOB_KEYS.PARSE_RETRY,
    label: '공시 파싱 재처리',
    source: 'CRON_RUN_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: 120, // 30분 간격 — 2시간 무가동이면 정체
    cadence: '매 30분',
  },
  {
    jobKey: CRON_JOB_KEYS.PIPELINE_DRAIN,
    label: '파이프라인 폐루프 드레인',
    source: 'CRON_RUN_LOG',
    window: 'ALWAYS',
    // DAR-392: 카덴스 15분→1분(연속 드레인). 단, 적응형 백오프(레이트리밋/쿼터)로 최대 30분
    //   쿨다운할 수 있으므로 stale 임계는 그 위(45분)로 둬 정상 백오프를 오탐하지 않는다.
    staleAfterMinutes: 45, // 1분 간격이나 백오프 최대 30분 — 45분 무가동이면 정체(DAR-392)
    cadence: '매 1분(연속, 레이트리밋 시 적응형 백오프)',
  },
  {
    jobKey: CRON_JOB_KEYS.EVENT_STUDY_CALC,
    label: 'Event Study baseline 산출',
    source: 'CRON_RUN_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: 14_400, // 10일 — 주간 카덴스 + 한 주 누락까지 흡수(DAR-134)
    cadence: '주간(토) 04:00',
  },
  {
    // DAR-232: 자정 정리 실패는 dead-token·읽은알림 무한 누적으로 번질 수 있어
    // 안전망에 노출한다. 매일 가동(주말 포함) — 하루 누락(48h)까지 허용.
    jobKey: CRON_JOB_KEYS.CLEANUP_DAILY,
    label: '만료 토큰·알림 정리',
    source: 'CRON_RUN_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: 2_880, // 48시간 — 매일 자정, 하루 누락까지 허용
    cadence: '매일 자정',
  },
  {
    // DAR-232: 장중 분단위 폴러. 16:00~18:30(폴링 종료~윈도 끝) 공백을 흡수하도록
    // 임계를 넉넉히(3h) 잡아 장중 무가동만 stale 로 표면화. 키 미설정 시엔 기록 자체가
    // 없으므로(폴러가 no-op) 운영 중 종목 폴링이 멈춘 경우만 잡힌다.
    jobKey: CRON_JOB_KEYS.KIS_REALTIME,
    label: 'KIS 실시간 현재가 폴링',
    source: 'CRON_RUN_LOG',
    window: 'WEEKDAY_INTRADAY',
    staleAfterMinutes: 180, // 3시간 — 폴링 종료(15:59)~윈도 끝(18:30) 공백 흡수
    cadence: '평일 09:00~15:59 / 1분 간격',
  },
  {
    // DAR-347: FAILED 이벤트 자동복구 크론. 가동이 멈추면 FAILED 가 무한 적체되어
    // 사일런트 손실로 번지므로 안전망에 노출한다. 매시간 가동 — 2시간 무가동이면 stale.
    jobKey: CRON_JOB_KEYS.FAILED_EVENT_RECOVERY,
    label: 'FAILED 이벤트 자동복구',
    source: 'CRON_RUN_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: 120, // 2시간 — 매시간 가동, 한 사이클 누락까지 허용
    cadence: '매시간',
  },
  {
    // DAR-366: 장중 손절 모니터. 정규장(09:00~15:30) 내 N분 가동. 16:00~ 장 마감 후 공백을
    //   흡수하도록 임계를 넉넉히(3h). 키 미설정/장외엔 기록이 없으므로(스킵) 장중 무가동만 stale.
    jobKey: CRON_JOB_KEYS.INTRADAY_EXIT_MONITOR,
    label: '장중 손절 모니터',
    source: 'CRON_RUN_LOG',
    window: 'WEEKDAY_INTRADAY',
    staleAfterMinutes: 180, // 3시간 — 장 마감(15:30)~윈도 끝 공백 흡수
    cadence: '평일 09:00~15:30 / 5분 간격',
  },
  {
    // DAR-377: 분봉 수집(KIS 당일 분봉 → StockMinutePrice forward 축적). 정규장 내 10분 간격 가동.
    //   장 마감(15:30)~윈도 끝 공백을 흡수하도록 임계를 넉넉히(3h). 키 미설정/장외엔 기록이 없으므로
    //   (no-op) 장중 무가동만 stale 로 표면화한다.
    jobKey: CRON_JOB_KEYS.MINUTE_PRICE_COLLECT,
    label: '분봉 수집',
    source: 'CRON_RUN_LOG',
    window: 'WEEKDAY_INTRADAY',
    staleAfterMinutes: 180, // 3시간 — 장 마감(15:30)~윈도 끝 공백 흡수
    cadence: '평일 09:00~15:30 / 10분 간격',
  },
  {
    // DAR-379: AI 평가 백필 드레인. 가동이 멈추면 과거 미분석 공시 적체가 영구화되어
    //   AI 평가자료 커버리지가 정체된다. 매일 02:00 가동 — 하루 누락(48h)까지 허용.
    jobKey: CRON_JOB_KEYS.AI_BACKFILL_DRAIN,
    label: 'AI 평가 백필 드레인',
    source: 'CRON_RUN_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: 2_880, // 48시간 — 매일 02:00, 하루 누락까지 허용
    cadence: '매일 02:00',
  },
  {
    // DAR-391: 이벤트 추출 백필 드레인. 가동이 멈추면 과거 백필 공시의 이벤트 추출 적체가
    //   영구화되어 신호·백테스트 연중화가 정체된다(rcpDt 분포 비어있음). 매일 03:00 가동 —
    //   하루 누락(48h)까지 허용.
    jobKey: CRON_JOB_KEYS.EVENT_BACKFILL_DRAIN,
    label: '이벤트 추출 백필 드레인',
    source: 'CRON_RUN_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: 2_880, // 48시간 — 매일 03:00, 하루 누락까지 허용
    cadence: '매일 03:00',
  },
  {
    // DAR-395: rawText 오프로드 드레인. 가동이 멈추면 과거 원문 이전이 정체되어 DB 경량화가
    //   진행되지 않는다(멀티이어 백필 시 폭증 위험). 매 10분 가동 — 1시간 무가동이면 stale.
    //   잔여가 0이 되면 더 옮길 게 없어도 cron 은 계속 RAN(드레인 0건)이므로 신선도는 유지된다.
    jobKey: CRON_JOB_KEYS.RAWTEXT_OFFLOAD_DRAIN,
    label: 'rawText 오프로드 드레인',
    source: 'CRON_RUN_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: 60, // 10분 간격 — 1시간 무가동이면 정체
    cadence: '매 10분',
  },
];
