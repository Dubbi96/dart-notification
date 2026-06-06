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
];
