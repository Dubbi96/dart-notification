// 데이터 신선도(freshness) 판정 — 순수 함수 (DAR-110, 수집 안전망)
//
// 입력: 잡별 마지막 성공시각/상태/건수 + 잡 사양(허용 경과시간·평가 윈도).
// 출력: 잡별 stale 여부와 사람이 읽을 수 있는 사유.
// 외부호출·DB·AI 없음 — 시간 비교만. `now` 를 주입받아 결정론적으로 테스트 가능.
//
// 핵심 감사 동기: 수집이 '조용히' 멈추면 신호·수익검증 입력이 통째로 비어도 인지하지 못한다.
// 따라서 마지막 성공이 허용 경과시간을 넘기면 stale=true 로 표면화한다.
//
// [W11] 제로런(zero-run) 축 증축: 크론이 '살아서 성공을 남기지만 산출이 0행'인 정체는
// ageMinutes 축이 영원히 잡지 못한다(마지막 성공시각은 계속 갱신되므로). 2026-07-15
// 라이브 파싱 기아 장애가 이 클래스 — 잡은 돌았지만 산출 0으로 신호가 굶었다.
// 장중 시간대에 기대 크론이 연속 N회 0행을 산출하면 stale 로 표면화한다.
//
// [DAR-515] 휴장일 오탐 0: 장중 윈도 판정은 시장캘린더 SSOT(market-calendar.isTradingDay)를
// 참조해 평일 공휴일·대체공휴일엔 판정 자체를 보류한다(age·제로런 두 축 모두). 공시 폴링
// 크론은 요일 기반(`*/10 8-17 * * 1-5`)이라 평일 공휴일에도 돌며 0행 SUCCESS 를 남기므로,
// 캘린더 없이는 그 0행 연속이 제로런 오탐이 된다(예: 2026-08-17 광복절 대체 — 하반기 최초 위험일).

import { isTradingDay } from '../common/time/market-calendar';

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
  /**
   * [W11] 제로런 감지 임계(선택) — 장중 시간대에 '당일' 연속 성공 실행 N회가 전부 0행
   * 산출이면 stale. 미지정이면 제로런 축 미평가(기존 ageMinutes 축만).
   * ★장중에만 산출이 기대되는 잡(공시 폴링·실시간가·분봉)에만 부여할 것 — 0행이 정상인
   *   잡(재처리·드레인류)에 부여하면 상시 오탐이 된다.
   */
  zeroRunThreshold?: number;
}

/** [W11] 제로런 판정용 최근 성공 실행 1건(최신순 배열의 원소). */
export interface RecentSuccessRun {
  /** 성공 실행 종료시각. */
  finishedAt: Date;
  /** 해당 실행의 처리/신규 건수. 미기록이면 null(0 과 구분 — null 은 제로런으로 안 친다). */
  itemCount: number | null;
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
  /**
   * [W11] 최근 성공 실행 이력(최신순, zeroRunThreshold 건이면 충분).
   * zeroRunThreshold 미지정 잡은 생략 가능(제로런 축 미평가).
   */
  recentRuns?: RecentSuccessRun[];
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
  /**
   * [W11] 당일 연속 0행 성공 실행 횟수. 제로런 축 미대상(zeroRunThreshold 미지정) 또는
   * 판정 보류(장외 등) 시 null. 비-0/미상(null) 산출 또는 전일 기록을 만나면 카운트가 끊긴다.
   */
  zeroRunStreak: number | null;
  /** [W11] 제로런(연속 0행 산출) 정체로 stale 판정됐는가. */
  isZeroRun: boolean;
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

/** 서버 로컬 날짜의 YYYYMMDD — 시장캘린더(isTradingDay) 조회용. isSameLocalDay 와 동일 로컬 기준. */
function localYmd(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/**
 * 거래일 여부 — 시장캘린더 SSOT(market-calendar) 참조. 주말 + KRX 공휴일·대체공휴일 모두 비거래일.
 * [DAR-515] 요일만 보던 기존 판정을 대체 — 평일 공휴일 오탐(제로런·age)을 원천 차단한다.
 */
function isTradingLocalDay(now: Date): boolean {
  return isTradingDay(localYmd(now));
}

/**
 * 장중 폴링 윈도 — 거래일 08:00 ~ 18:30(서버 로컬).
 * 폴링 크론('*\/10 8-17')은 08:00~17:59 실행, 마지막 실행 반영 여유로 18:30 까지 평가.
 * [DAR-515] 휴장일(주말·공휴일)엔 false — 판정을 보류해 오탐 0.
 */
function isWithinIntradayWindow(now: Date): boolean {
  if (!isTradingLocalDay(now)) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const open = 8 * 60; // 08:00
  const close = 18 * 60 + 30; // 18:30
  return minutes >= open && minutes <= close;
}

/** 같은 서버 로컬 날짜인가 — 제로런 스트릭의 '당일' 경계(이 모듈의 로컬시간 관례와 일치). */
function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * [W11] 당일 연속 0행 성공 실행 횟수 — 최신 실행부터 거슬러 세되,
 *  - 전일 이전 기록을 만나면 중단(휴장/주말 이월 기록의 오탐 방지 — 당일 실적만 유효),
 *  - 비-0 산출 또는 건수 미상(null)을 만나면 중단(연속 카운트 리셋).
 */
function countZeroRunStreak(recentRuns: RecentSuccessRun[], now: Date): number {
  let streak = 0;
  for (const run of recentRuns) {
    if (!isSameLocalDay(run.finishedAt, now)) break;
    if (run.itemCount !== 0) break;
    streak += 1;
  }
  return streak;
}

/** 단일 잡 신선도 판정. */
export function evaluateJobFreshness(
  input: FreshnessJobInput,
  now: Date,
): FreshnessJobResult {
  const { spec, lastSuccessAt, lastStatus, lastItemCount, recentRuns } = input;

  const base = {
    jobKey: spec.jobKey,
    label: spec.label,
    cadence: spec.cadence,
    lastSuccessAt: lastSuccessAt ? lastSuccessAt.toISOString() : null,
    lastStatus,
    lastItemCount,
  };

  // 1) 평가 윈도 밖이면 판정 보류(장외시간·휴장일 오탐 방지). 제로런 축도 함께 보류.
  //    휴장일(주말·공휴일)과 장외시간을 사유로 구분해 표기한다([DAR-515] 시장캘린더 참조).
  if (spec.window === 'WEEKDAY_INTRADAY' && !isWithinIntradayWindow(now)) {
    return {
      ...base,
      applicable: false,
      isStale: false,
      ageMinutes: lastSuccessAt
        ? Math.floor((now.getTime() - lastSuccessAt.getTime()) / MS_PER_MINUTE)
        : null,
      zeroRunStreak: null,
      isZeroRun: false,
      reason: isTradingLocalDay(now)
        ? '장외시간 — 신선도 판정 보류'
        : '휴장일(주말·공휴일) — 신선도 판정 보류',
    };
  }

  // 2) 성공 기록이 한 번도 없음 → stale(수집이 아직/전혀 돌지 않음).
  if (lastSuccessAt === null) {
    return {
      ...base,
      applicable: true,
      isStale: true,
      ageMinutes: null,
      zeroRunStreak: null,
      isZeroRun: false,
      reason: '성공 기록 없음 — 수집 미가동 의심',
    };
  }

  // 3) 마지막 성공 이후 경과시간 비교(기존 age 축).
  const ageMinutes = Math.floor(
    (now.getTime() - lastSuccessAt.getTime()) / MS_PER_MINUTE,
  );
  const ageStale = ageMinutes > spec.staleAfterMinutes;

  // 4) [W11] 제로런 축 — 임계가 부여된 잡만, 장중 시간대에만 평가(장외 미발화).
  //    잡은 성공을 남기며 살아 있으나 산출이 계속 0행인 정체(2026-07-15 기아 클래스)를 잡는다.
  const zeroRunApplicable =
    spec.zeroRunThreshold != null &&
    spec.zeroRunThreshold > 0 &&
    isWithinIntradayWindow(now);
  const zeroRunStreak = zeroRunApplicable
    ? countZeroRunStreak(recentRuns ?? [], now)
    : null;
  const isZeroRun =
    zeroRunApplicable && (zeroRunStreak as number) >= (spec.zeroRunThreshold as number);

  const isStale = ageStale || isZeroRun;
  const reason = ageStale
    ? `마지막 성공 후 ${ageMinutes}분 경과(허용 ${spec.staleAfterMinutes}분 초과) — 수집 정체 의심`
    : isZeroRun
      ? `장중 연속 ${zeroRunStreak}회 0행 산출(임계 ${spec.zeroRunThreshold}회) — 제로런 정체 의심`
      : `정상 — 마지막 성공 후 ${ageMinutes}분(허용 ${spec.staleAfterMinutes}분 이내)`;

  return {
    ...base,
    applicable: true,
    isStale,
    ageMinutes,
    zeroRunStreak,
    isZeroRun,
    reason,
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
