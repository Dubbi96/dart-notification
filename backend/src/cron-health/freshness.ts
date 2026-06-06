// 데이터 신선도(freshness) 판정 — 순수 함수 (DAR-110, 수집 안전망)
//
// 입력: 잡별 마지막 성공시각/상태/건수 + 잡 사양(허용 경과시간·평가 윈도).
// 출력: 잡별 stale 여부와 사람이 읽을 수 있는 사유.
// 외부호출·DB·AI 없음 — 시간 비교만. `now` 를 주입받아 결정론적으로 테스트 가능.
//
// 핵심 감사 동기: 수집이 '조용히' 멈추면 신호·수익검증 입력이 통째로 비어도 인지하지 못한다.
// 따라서 마지막 성공이 허용 경과시간을 넘기면 stale=true 로 표면화한다.

/** 잡 평가 윈도 — 언제 stale 판정을 적용할지. */
export type FreshnessWindow =
  // 24/7 또는 일/주 단위 — 항상 평가.
  | 'ALWAYS'
  // 장중 폴링 — 평일 08:00~18:30(서버 로컬) 구간에만 평가. 장외시간엔 판정 보류.
  | 'WEEKDAY_INTRADAY';

/** 모니터링 대상 크론 1건의 사양(정적 메타). */
export interface FreshnessJobSpec {
  /** 잡 식별 키 — CronRunLog.jobKey 또는 도메인 로그 식별자. */
  jobKey: string;
  /** 사용자/운영자 노출 라벨. */
  label: string;
  /** 데이터 출처(어느 로그/테이블에서 lastSuccessAt 을 얻는가). */
  source:
    | 'CRON_RUN_LOG'
    | 'DISCLOSURE_LOG'
    | 'MARKET_DATA_LOG'
    | 'FINANCIAL_LOG';
  /** 평가 윈도. */
  window: FreshnessWindow;
  /**
   * 마지막 성공 이후 이 분(minute)을 넘기면 stale.
   * 일 단위 평일 크론은 주말 공백을 흡수하도록 넉넉히 잡는다(오탐 방지).
   */
  staleAfterMinutes: number;
  /** 운영자용 카덴스 설명(표시 전용). */
  cadence: string;
}

/** 잡별 런타임 입력(로그에서 조회한 값). */
export interface FreshnessJobInput {
  spec: FreshnessJobSpec;
  /** 마지막 성공 종료시각. 한 번도 성공 기록이 없으면 null. */
  lastSuccessAt: Date | null;
  /** 마지막 실행 상태(성공 여부 무관). 기록 없으면 null. */
  lastStatus: string | null;
  /** 마지막 성공 실행의 처리/신규 건수. 없으면 null. */
  lastItemCount: number | null;
}

/** 잡별 판정 결과. */
export interface FreshnessJobResult {
  jobKey: string;
  label: string;
  cadence: string;
  /** 현재 윈도에서 stale 판정을 적용했는가(false=장외시간 등으로 보류). */
  applicable: boolean;
  /** stale 여부(applicable=false 면 항상 false). */
  isStale: boolean;
  lastSuccessAt: string | null;
  lastStatus: string | null;
  lastItemCount: number | null;
  /** 마지막 성공 이후 경과(분). 성공 기록 없으면 null. */
  ageMinutes: number | null;
  /** 사람이 읽는 사유. */
  reason: string;
}

/** 전체 신선도 리포트. */
export interface FreshnessReport {
  generatedAt: string;
  /** 적용 가능한 잡 중 하나라도 stale 이면 true(수집 안전망 경보). */
  anyStale: boolean;
  /** stale 로 판정된 잡 키 목록. */
  staleJobs: string[];
  jobs: FreshnessJobResult[];
}

const MS_PER_MINUTE = 60_000;

/** 평일(월~금) 여부 — 서버 로컬 시간 기준. */
function isWeekday(now: Date): boolean {
  const day = now.getDay(); // 0=일, 6=토
  return day >= 1 && day <= 5;
}

/**
 * 장중 폴링 윈도 — 평일 08:00 ~ 18:30(서버 로컬).
 * 폴링 크론('*\/10 8-17')은 08:00~17:59 실행, 마지막 실행 반영 여유로 18:30 까지 평가.
 */
function isWithinIntradayWindow(now: Date): boolean {
  if (!isWeekday(now)) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const open = 8 * 60; // 08:00
  const close = 18 * 60 + 30; // 18:30
  return minutes >= open && minutes <= close;
}

/** 단일 잡 신선도 판정. */
export function evaluateJobFreshness(
  input: FreshnessJobInput,
  now: Date,
): FreshnessJobResult {
  const { spec, lastSuccessAt, lastStatus, lastItemCount } = input;

  const base = {
    jobKey: spec.jobKey,
    label: spec.label,
    cadence: spec.cadence,
    lastSuccessAt: lastSuccessAt ? lastSuccessAt.toISOString() : null,
    lastStatus,
    lastItemCount,
  };

  // 1) 평가 윈도 밖이면 판정 보류(장외시간 오탐 방지).
  if (spec.window === 'WEEKDAY_INTRADAY' && !isWithinIntradayWindow(now)) {
    return {
      ...base,
      applicable: false,
      isStale: false,
      ageMinutes: lastSuccessAt
        ? Math.floor((now.getTime() - lastSuccessAt.getTime()) / MS_PER_MINUTE)
        : null,
      reason: '장외시간 — 신선도 판정 보류',
    };
  }

  // 2) 성공 기록이 한 번도 없음 → stale(수집이 아직/전혀 돌지 않음).
  if (lastSuccessAt === null) {
    return {
      ...base,
      applicable: true,
      isStale: true,
      ageMinutes: null,
      reason: '성공 기록 없음 — 수집 미가동 의심',
    };
  }

  // 3) 마지막 성공 이후 경과시간 비교.
  const ageMinutes = Math.floor(
    (now.getTime() - lastSuccessAt.getTime()) / MS_PER_MINUTE,
  );
  const isStale = ageMinutes > spec.staleAfterMinutes;

  return {
    ...base,
    applicable: true,
    isStale,
    ageMinutes,
    reason: isStale
      ? `마지막 성공 후 ${ageMinutes}분 경과(허용 ${spec.staleAfterMinutes}분 초과) — 수집 정체 의심`
      : `정상 — 마지막 성공 후 ${ageMinutes}분(허용 ${spec.staleAfterMinutes}분 이내)`,
  };
}

/** 전체 신선도 리포트 빌드. */
export function buildFreshnessReport(
  inputs: FreshnessJobInput[],
  now: Date,
): FreshnessReport {
  const jobs = inputs.map((i) => evaluateJobFreshness(i, now));
  const staleJobs = jobs.filter((j) => j.isStale).map((j) => j.jobKey);
  return {
    generatedAt: now.toISOString(),
    anyStale: staleJobs.length > 0,
    staleJobs,
    jobs,
  };
}
