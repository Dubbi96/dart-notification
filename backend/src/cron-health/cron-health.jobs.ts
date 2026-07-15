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
  // DAR-428: 일봉 전진수집 — 평일 EOD(18:30) KRX 일봉 캐치업의 cron 실행 헬스를 CronRunLog 에
  //   first-class 로 남긴다(분봉과 대칭). 도메인 MarketDataCollectionLog 는 '무엇을 적재했나'를,
  //   이 키는 '크론이 살아 돌았나'를 본다 — 이 둘이 분리돼 있어야 EOD 크론이 조용히 멈춘
  //   (일봉 6/18 정체) 사건이 신선도 안전망에 표면화된다.
  DAILY_PRICE_COLLECT: 'market.daily-collect',
  // 일일 기술지표 계산 — 평일 18:50(18:30 일봉 캐치업 후·19:00 신호 생성 전) + 21:10(21:00 일봉
  //   재시도 후) 동일 경로 재발화. StockDailyPrice → TechnicalIndicator(mode=latest) 멱등 upsert.
  //   지표 적재가 조용히 멈추면 신호 생성의 지표 컨텍스트가 전부 null 이 되어 chart 버킷 전멸 →
  //   매수등급 신호 소멸(홈 '오늘의 투자판단' 정체)로 번지므로 신선도 안전망에 노출한다.
  INDICATOR_DAILY: 'market.indicator-daily',
  // DAR-486(견고화 W3·P25): 종목상태 일별 이력 적재 — 평일 08:50 KRX/DART 종목상태 수집이
  //   forward-only 로 stock_status_daily 에 스냅샷을 축적한다(백테스트 생존편향 처리 입력).
  //   적재가 조용히 멈추면 백테스트 현실성 개선이 정체되므로 신선도 안전망에 노출한다.
  STOCK_STATUS_COLLECT: 'market.status-collect',
  // DAR-379: AI 평가 백필 드레인 — 과거 미분석 공시를 비용게이트 내 점진 드레인(평가자료 코퍼스 적재).
  AI_BACKFILL_DRAIN: 'ai.backfill-drain',
  // DAR-391: 이벤트 추출 백필 드레인 — 과거 백필 공시를 rcpDt 시간순 추출/파싱등록(신호·백테스트 연중화 게이트).
  EVENT_BACKFILL_DRAIN: 'event.backfill-drain',
  // DAR-395: rawText 객체 스토리지 오프로드 드레인 — 과거 원문을 S3/로컬로 이전 후 DB 컬럼 비움(경량화).
  RAWTEXT_OFFLOAD_DRAIN: 'rawtext.offload-drain',
  // DAR-399: tables(파싱 표 JSONB·TOAST 진짜 bulk) 객체 스토리지 오프로드 드레인 — S3/로컬 이전 후 컬럼 비움.
  TABLES_OFFLOAD_DRAIN: 'tables.offload-drain',
  // DAR-396: 연속 과거 확장 백필 — 공시 메타데이터를 DART 가용 최초까지 월 단위로 내려가며 수집(쿼터 인지).
  DISCLOSURE_BACKFILL_EXTEND: 'disclosure.backfill-extend',
  // DAR-404: 전략 변형 4종 다중 트랙 갱신 — 데이터 누적분을 반영해 1일 1회 백테스트 트랙 재산출.
  STRATEGY_TRACK_REFRESH: 'strategy.track-refresh',
  // DAR-411: 분봉 단타 모의전략 — 정규장 매 10분 유니버스→진입→청산 평가(forward-only 페이퍼 트랙).
  INTRADAY_SCALP: 'paper.intraday-scalp',
  // live-readiness W1: 철학 스타일 4트랙 일일 사이클 — 크론 미배선으로 미가동이던 결함 교정(평일 19:40).
  STYLE_SIMULATION: 'paper.style-simulation',
  // live-readiness W1: 전략 변형 4종 forward 모의운용 — 리플레이(BacktestRun)와 별개의 실운용 트랙(평일 19:45).
  STRATEGY_FORWARD: 'paper.strategy-forward',
  // DAR-477(견고화 W0·P05): 일일 운영 리포트 — 장마감 후(20:30) 손익·체결·오류율 요약을 OPS_ALERT 로 발송.
  //   forward 트랙(19:40/19:45) 이후 스냅샷. 발송 잡이 조용히 멈추면 운영 가시성이 사라지므로 안전망에 노출.
  OPS_DAILY_REPORT: 'ops.daily-report',
  // 격주 트랙 성과 순위 리포트 — 매주 일요일 10:00 발화하되 격주 게이트(isReviewSunday)로 앵커 기준
  //   짝수 주차만 실행(오프 주는 SKIPPED). 트랙 간 상대 성과 가시성이 조용히 멈추지 않게 안전망에 노출.
  BIWEEKLY_TRACK_REVIEW: 'ops.biweekly-track-review',
  // DAR-487(견고화 W3·P26): 장 시작 전 종합 프리플라이트 — 평일 08:30 토큰·휴장일·전일 일봉 정합·
  //   리스크 상태 일괄 점검(이상 시 RISK/OPS_ALERT). 이 잡이 조용히 멈추면 장 시작 전 이상 감지가
  //   사라지므로 안전망에 노출. 휴장 평일은 SKIPPED 로 기록돼 '크론은 살아 있음'이 유지된다.
  PRE_MARKET_PREFLIGHT: 'ops.pre-market-preflight',
  // DAR-484(견고화 W1·P10): ETF 일봉 증분 수집 — 장마감 후(19:10) KIS 기간별시세로 유니버스 4~5종
  //   당일 일봉을 EtfDailyPrice 에 forward 적재(Wave1 듀얼모멘텀/변동성돌파 토대). 기존 KRX 일봉 크론
  //   (18:30/21:00)과 시간대 분리. 수집이 조용히 멈추면 전략 입력이 비므로 안전망에 노출(결측→OPS_ALERT).
  ETF_DAILY_COLLECT: 'market.etf-daily-collect',
  // DAR-494(견고화 W1·P13): 듀얼모멘텀 코어 forward 트랙 — 평일 19:50 매일 발화(예약 체결·평가),
  //   판정은 월말 거래일 1회(P09 게이트). 월 단위 잡이라 stale 임계 ~35일. 가동이 멈추면 룰북
  //   §9.3.2 위험조정 게이트로 활성한 코어 트랙이 조용히 정체되므로 안전망에 노출.
  DUAL_MOMENTUM_FORWARD: 'paper.dual-momentum-forward',
  // DAR-498(견고화 W2·P22): 주문 원장 대조 — 매일 20:45 시스템 모의 체결(PaperTrade 파생)과 섀도
  //   원장(OrderRequest/OrderExecution)의 건수·수량·금액 정합을 대조(불일치→OPS_ALERT). 이 잡이
  //   조용히 멈추면 M11 실주문 계층의 원장 드리프트가 무감지로 쌓이므로 안전망에 노출.
  ORDER_LEDGER_RECONCILE: 'paper.order-ledger-reconcile',
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

// DAR-503: 헤비 수집 잡(연속 백필·tables/rawtext 오프로드)은 주말 창에만 실제 성공을 남긴다
//   (주중은 WINDOW_SKIPPED — freshness lastSuccessAt 미갱신). 주말→다음 주말 사이의 정상 공백
//   (일요일 성공 → 다음 토요일 ≈ 6일)을 흡수하도록 넉넉히(8일). 그 이상 비면 '주말 가동조차 멈춤'
//   으로 보고 stale — DataFreshnessMonitorScheduler(P02)가 OPS_ALERT 로 표면화한다.
const WEEKEND_HEAVY_STALE_MIN = 11_520; // 8일

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
    // DAR-428: 일봉 전진수집 EOD 크론. 평일 18:30 가동(KRX 일봉 캐치업). 장 마감 후 발행~익일
    //   가동까지의 공백 + 주말(금 성공→월 평가 ≈72h)을 흡수하도록 임계를 넉넉히(72h). 키
    //   미설정(KRX 미구성) 환경에선 본 작업이 graceful no-op 이라 CronRunLog 에 SUCCESS(적재 0)
    //   를 남겨 '크론은 살아 있음'이 유지된다 — 가동 자체가 멈춰야만 stale 로 표면화한다.
    jobKey: CRON_JOB_KEYS.DAILY_PRICE_COLLECT,
    label: '일봉 전진수집(EOD)',
    source: 'CRON_RUN_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: WEEKDAY_DAILY_STALE_MIN, // 72시간 — 평일 18:30, 주말 공백 흡수
    cadence: '평일 18:30 EOD',
  },
  {
    // 일일 기술지표 계산 크론. 평일 18:50 + 21:10 재시도 — 주말 공백(금→월 ≈72h) 흡수.
    //   prod TechnicalIndicator 0행 + 크론 부재로 신호 chart 버킷이 전멸했던 결함(홈 투자판단
    //   6월 중순 정체)의 재발 방지 안전망. 일봉이 없어 적재 0 이어도 SUCCESS(적재 0)를 남겨
    //   '크론은 살아 있음'이 유지된다 — 가동 자체가 멈춰야만 stale 로 표면화한다.
    jobKey: CRON_JOB_KEYS.INDICATOR_DAILY,
    label: '기술지표 일일 계산(EOD)',
    source: 'CRON_RUN_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: WEEKDAY_DAILY_STALE_MIN, // 72시간 — 평일 18:50/21:10, 주말 공백 흡수
    cadence: '평일 18:50 + 21:10 재시도',
  },
  {
    // DAR-486: 종목상태 일별 이력 적재(08:50). forward-only 로 stock_status_daily 에 이상상태
    //   스냅샷을 쌓아 백테스트 어댑터에 point-in-time 플래그를 공급한다. KRX/DART 미설정 환경에선
    //   graceful(적재 0)이라 CronRunLog 에 SUCCESS 를 남겨 '크론 살아있음'이 유지된다 — 가동 자체가
    //   멈춰야만 stale 로 표면화. 평일 08:50, 주말 공백(금→월 ≈72h) 흡수.
    jobKey: CRON_JOB_KEYS.STOCK_STATUS_COLLECT,
    label: '종목상태 일별 이력 적재',
    source: 'CRON_RUN_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: WEEKDAY_DAILY_STALE_MIN, // 72시간 — 평일 08:50, 주말 공백 흡수
    cadence: '평일 08:50',
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
    //   영구화되어 신호·백테스트 연중화가 정체된다(rcpDt 분포 비어있음).
    // DAR-503(라이브 파싱 기아 후속): 매일 03:00 발화하나 실제 드레인은 주말 창에만(주중
    //   WINDOW_SKIPPED — 자정 쿼터 리셋 직후 문서 fetch 벌크 소비가 라이브 파싱을 굶기던
    //   것을 해소). 주말→다음 주말 공백을 흡수하도록 임계 8일로 상향.
    jobKey: CRON_JOB_KEYS.EVENT_BACKFILL_DRAIN,
    label: '이벤트 추출 백필 드레인',
    source: 'CRON_RUN_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: WEEKEND_HEAVY_STALE_MIN, // 8일 — 주말 전용(DAR-503), 주말간 공백 흡수
    cadence: '주말 03:00(주중 정지·DAR-503)',
  },
  {
    // DAR-395: rawText 오프로드 드레인. 가동이 멈추면 과거 원문 이전이 정체되어 DB 경량화가
    //   진행되지 않는다(멀티이어 백필 시 폭증 위험).
    // DAR-503: 매 10분 발화하나 실제 드레인은 주말 창에만(주중 WINDOW_SKIPPED — 대형 스캔이
    //   커넥션 풀을 독점하던 것을 해소). 주말→다음 주말 공백을 흡수하도록 임계 8일로 상향.
    //   잔여가 0이 되면 더 옮길 게 없어도 주말엔 계속 RAN(드레인 0건)이라 신선도는 유지된다.
    jobKey: CRON_JOB_KEYS.RAWTEXT_OFFLOAD_DRAIN,
    label: 'rawText 오프로드 드레인',
    source: 'CRON_RUN_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: WEEKEND_HEAVY_STALE_MIN, // 8일 — 주말 전용(DAR-503), 주말간 공백 흡수
    cadence: '주말 매 10분(주중 정지·DAR-503)',
  },
  {
    // DAR-399: tables 오프로드 드레인. tables JSONB 가 disclosure_documents TOAST 의 진짜 bulk(~1.6GB).
    //   가동이 멈추면 과거 tables 이전이 정체되어 DB 경량화가 진행되지 않는다.
    // DAR-503: 매 10분 발화하나 실제 드레인은 주말 창에만(주중 WINDOW_SKIPPED). tables LEFT JOIN
    //   대형 스캔이 주중 풀 고갈(health 503)의 주범이라 주말로 이전. 임계 8일로 상향(주말간 공백).
    //   잔여가 0이 되면 더 옮길 게 없어도 주말엔 계속 RAN(드레인 0건)이라 신선도는 유지된다.
    jobKey: CRON_JOB_KEYS.TABLES_OFFLOAD_DRAIN,
    label: 'tables 오프로드 드레인',
    source: 'CRON_RUN_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: WEEKEND_HEAVY_STALE_MIN, // 8일 — 주말 전용(DAR-503), 주말간 공백 흡수
    cadence: '주말 매 10분(주중 정지·DAR-503)',
  },
  {
    // DAR-396: 연속 과거 확장 백필. 일일 쿼터 소진 시 PARTIAL 로 멈췄다 다음 리셋(자정) 후 재개된다.
    // DAR-503: 매시간 발화하나 실제 백필은 주말 창에만(주중 WINDOW_SKIPPED — DART 일일쿼터를
    //   라이브 수집과 경쟁시키던 대량 소비원을 주말로 이전). 주말→다음 주말 공백 + 쿼터 소진 구간을
    //   흡수하도록 임계 8일로 상향. 하한 도달 후엔 no-op 이라 기록이 멈출 수 있으나 그건 '완료'다.
    jobKey: CRON_JOB_KEYS.DISCLOSURE_BACKFILL_EXTEND,
    label: '연속 과거 확장 백필',
    source: 'CRON_RUN_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: WEEKEND_HEAVY_STALE_MIN, // 8일 — 주말 전용(DAR-503), 주말간 공백+쿼터 흡수
    cadence: '주말 매시간(주중 정지·DAR-503, 쿼터 소진 시 리셋 후 재개)',
  },
  {
    // DAR-404: 전략 변형 4종 다중 트랙 갱신. 가동이 멈추면 데이터가 늘어도 트랙이 오래된 채 고정된다.
    //   매일 05:00 가동(off-hours·저부하) — 하루 누락(48h)까지 허용.
    jobKey: CRON_JOB_KEYS.STRATEGY_TRACK_REFRESH,
    label: '전략 변형 다중 트랙 갱신',
    source: 'CRON_RUN_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: 2_880, // 48시간 — 매일 05:00, 하루 누락까지 허용
    cadence: '매일 05:00',
  },
  {
    // DAR-411: 분봉 단타 모의전략. 정규장(09:00~15:30) 내 10분 간격 진입·청산 평가.
    //   장 마감 후 공백을 흡수하도록 임계를 넉넉히(3h). 장외/주말/휴장/분봉 미수집엔 스킵이라
    //   기록이 없으므로 장중 무가동만 stale 로 표면화한다.
    jobKey: CRON_JOB_KEYS.INTRADAY_SCALP,
    label: '분봉 단타 진입·청산 평가',
    source: 'CRON_RUN_LOG',
    window: 'WEEKDAY_INTRADAY',
    staleAfterMinutes: 180, // 3시간 — 장 마감(15:30)~윈도 끝 공백 흡수
    cadence: '평일 09:02~15:52 / 10분 간격',
  },
  {
    // live-readiness W1: 철학 스타일 4트랙 일일 사이클. 가동이 멈추면 스타일 비교·persona 화면이
    //   조용히 정체된다(이번 결함의 재발 방지 안전망). 평일 19:40 — 주말 공백(금→월 ≈72h) 흡수.
    jobKey: CRON_JOB_KEYS.STYLE_SIMULATION,
    label: '철학 스타일 모의운용 일일 사이클',
    source: 'CRON_RUN_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: WEEKDAY_DAILY_STALE_MIN, // 72시간 — 평일 19:40, 주말 공백 흡수
    cadence: '평일 19:40',
  },
  {
    // live-readiness W1: 전략 변형 4종 forward 모의운용 일일 사이클. 리플레이 트랙(strategy.track-refresh)
    //   과 별개 — forward 실운용이 멈추면 룰 병렬 검증 데이터가 정체된다. 평일 19:45.
    jobKey: CRON_JOB_KEYS.STRATEGY_FORWARD,
    label: '전략 변형 forward 모의운용',
    source: 'CRON_RUN_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: WEEKDAY_DAILY_STALE_MIN, // 72시간 — 평일 19:45, 주말 공백 흡수
    cadence: '평일 19:45',
  },
  {
    // DAR-477(견고화 W0·P05): 일일 운영 리포트 발송 잡. 매일 20:30 KST — 발송이 멈추면 운영자가
    //   손익·오류율 가시성을 잃으므로 안전망에 노출. 매일 가동이나 하루 누락(48h)까지 허용.
    jobKey: CRON_JOB_KEYS.OPS_DAILY_REPORT,
    label: '일일 운영 리포트',
    source: 'CRON_RUN_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: 2_880, // 48시간 — 매일 20:30, 하루 누락까지 허용
    cadence: '매일 20:30',
  },
  {
    // 격주 트랙 성과 순위 리포트. 격주 일요일 10:00 KST 성공 — 오프 주 일요일은 SKIPPED 라
    //   lastSuccessAt 이 갱신되지 않으므로(정상), 임계는 격주(14일) 카덴스 + 3일 지연 흡수(17일).
    //   그 이상 비면 '격주 리포트가 조용히 멈춤'으로 보고 stale → OPS_ALERT 표면화(P02 경유).
    jobKey: CRON_JOB_KEYS.BIWEEKLY_TRACK_REVIEW,
    label: '격주 트랙 성과 리포트',
    source: 'CRON_RUN_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: 24_480, // 17일 — 격주 카덴스(14일) + 3일 지연 흡수
    cadence: '격주 일요일 10:00(오프 주는 SKIPPED)',
  },
  {
    // DAR-487(견고화 W3·P26): 장 시작 전 종합 프리플라이트. 평일 08:30 KST — 멈추면 장 시작 전
    //   토큰·데이터·리스크 이상 감지가 사라지므로 안전망에 노출. 평일 가동(휴장은 SKIPPED 기록)이라
    //   금요일 성공→월요일 평가(≈72h)의 주말 공백을 흡수하도록 임계를 넉넉히(72h).
    jobKey: CRON_JOB_KEYS.PRE_MARKET_PREFLIGHT,
    label: '장 시작 전 프리플라이트',
    source: 'CRON_RUN_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: WEEKDAY_DAILY_STALE_MIN, // 72시간 — 평일 08:30, 주말 공백 흡수
    cadence: '평일 08:30',
  },
  {
    // DAR-484(견고화 W1·P10): ETF 일봉 증분 수집 EOD 크론. 평일 19:10 가동(KIS 기간별시세로 유니버스
    //   4~5종 당일 일봉 forward 적재). 장 마감 후 발행~익일 가동까지의 공백 + 주말(금 성공→월 평가
    //   ≈72h)을 흡수하도록 임계를 넉넉히(72h). KIS 키 미설정 환경에선 graceful no-op 이라 CronRunLog 에
    //   SUCCESS(적재 0)를 남겨 '크론은 살아 있음'이 유지된다 — 가동 자체가 멈춰야만 stale 로 표면화한다.
    //   stale 전환 시 DataFreshnessMonitorScheduler(P02)가 OPS_ALERT 로 발송(결측 감지 경로 연동).
    jobKey: CRON_JOB_KEYS.ETF_DAILY_COLLECT,
    label: 'ETF 일봉 증분 수집(EOD)',
    source: 'CRON_RUN_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: WEEKDAY_DAILY_STALE_MIN, // 72시간 — 평일 19:10, 주말 공백 흡수
    cadence: '평일 19:10 EOD',
  },
  {
    // DAR-494(견고화 W1·P13): 듀얼모멘텀 코어 forward 트랙 일일 사이클(평일 19:50). 판정은 월말
    //   거래일 1회(P09 게이트)뿐이고 그 외엔 예약 체결·평가 no-op 이라 **월 단위 잡**이다. 한 달 내내
    //   no-op(SUCCESS 기록)이 정상이므로 stale 임계를 넉넉히(35일=50,400분) 둬 오탐을 막는다.
    //   가동 자체가 멈춰야만 stale → DataFreshnessMonitorScheduler(P02)가 OPS_ALERT 로 발송.
    jobKey: CRON_JOB_KEYS.DUAL_MOMENTUM_FORWARD,
    label: '듀얼모멘텀 코어 forward 사이클',
    source: 'CRON_RUN_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: 50_400, // 35일 — 월 단위 잡(월말 판정 1회), 한 달 no-op 흡수
    cadence: '평일 19:50(판정은 월말 거래일 1회)',
  },
  {
    // DAR-498(견고화 W2·P22): 주문 원장 대조. 매일 20:45 가동(주말 포함 — 신규 체결 없으면 '정합 0건'
    //   무소음 SUCCESS). 매일 발화 + 하루 누락까지 허용하도록 임계를 넉넉히(48h). 가동 자체가
    //   멈춰야만 stale → 원장 드리프트 무감지 리스크가 표면화된다.
    jobKey: CRON_JOB_KEYS.ORDER_LEDGER_RECONCILE,
    label: '주문 원장 대조',
    source: 'CRON_RUN_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: 2_880, // 48시간 — 매일 20:45, 하루 누락까지 허용
    cadence: '매일 20:45',
  },
];
