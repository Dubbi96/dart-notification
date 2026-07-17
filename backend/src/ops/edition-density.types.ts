/**
 * edition-density.types.ts — 에디션 밀도 실측 리포트 타입 (DAR-513, Wave A/A3)
 *
 * '1거래일=1호' 에디션이 '대부분 빈 신문'인지 판정할 데이터 계약.
 * 정본: docs/roadmap/cc-pm-cycle1-plan-2026-07-17.md (Wave A) ·
 *       docs/roadmap/cc-daily-investment-edition-2026-07-16.md (에디션 설계 SSOT)
 */

/** 밀도 판정 임계 — 정본 수용기준(중앙값<2 또는 0건일>40%). 응답에 동봉해 판정 근거를 정직 고지. */
export const EDITION_DENSITY_THRESHOLDS = {
  /** 중앙값이 이 값 미만이면 트리거(엄격 미만). */
  medianLt: 2,
  /** 0건일 비율이 이 값 초과면 트리거(엄격 초과). */
  zeroDayRatioGt: 0.4,
} as const;

/** 폴백 제안서 경로(수용기준 2 — 오너 판정 회부용). 트리거 시 응답이 이 문서를 가리킨다. */
export const EDITION_DENSITY_FALLBACK_PROPOSAL_DOC =
  'docs/roadmap/cc-edition-density-fallback-proposal-2026-07-17.md';

/** 신호 건수 히스토그램 1버킷. */
export interface DensityHistogramBucket {
  /** 버킷 라벨('0' | '1' | '2' | '3-4' | '5-9' | '10+'). */
  bucket: string;
  /** 이 버킷에 속한 거래일 수. */
  days: number;
}

/** 거래일별 신호 건수 분포 통계(한 계열: 매수등급 또는 전등급). */
export interface DensityStats {
  /** 표본 거래일 수(= windowTradingDays). */
  days: number;
  /** 윈도 내 총 신호 건수. */
  totalSignals: number;
  /** 거래일당 평균(소수 2자리 반올림). */
  mean: number;
  /** 거래일당 중앙값(짝수 표본은 두 중앙값 평균 → 소수 가능). */
  median: number;
  /** 거래일당 최소. */
  min: number;
  /** 거래일당 최대. */
  max: number;
  /** 25백분위(nearest-rank). */
  p25: number;
  /** 75백분위(nearest-rank). */
  p75: number;
  /** 0건인 거래일 수. */
  zeroDays: number;
  /** 0건일 비율(0~1, 소수 4자리 반올림). */
  zeroDayRatio: number;
  /** 건수 구간별 거래일 분포. */
  histogram: DensityHistogramBucket[];
}

/** 거래일 1행(최신 우선). */
export interface DensityDailyRow {
  /** KST 거래일(YYYYMMDD). */
  date: string;
  /**
   * 매수등급(STRONG_BUY+BUY) 에디션 신호 건수(TradingSignal 원시 행수, 페르소나별 중복 포함).
   * ★DAR-553 이후 `GET /signals/daily-editions`의 count(corp당 대표 1건)와 더 이상 1:1 아님 —
   * 실제 카드 수는 `uniqueCorpBuyCount` 참조.
   */
  buyCount: number;
  /** 전등급 신호 건수(백필 제외) — 파이프라인이 신호는 만드나 매수등급이 아닐 뿐인지 진단용. */
  totalCount: number;
  /**
   * DAR-553: 매수등급 신호의 유니크 종목(corpCode) 수 — 페르소나 중복 제거.
   * `GET /signals/daily-editions`의 count·에디션 실제 노출 카드 수와 1:1 일치.
   */
  uniqueCorpBuyCount: number;
}

/** 분모(거래일 수) 교차검증 — 캘린더 규칙 vs 운영 데이터(일봉 실재일). */
export interface TradingDayCrossCheck {
  /** 캘린더 규칙(market-calendar SSOT, isTradingDay) 기준 거래일 수 = windowTradingDays. */
  calendarTradingDays: number;
  /** 윈도 구간 내 일봉(StockDailyPrice) 실재 거래일 distinct 수. 데이터 없으면 null. */
  marketDataTradingDays: number | null;
  /** 두 트랙 일치 여부. 데이터 없으면 null. */
  matches: boolean | null;
  /** 교차검증 의미 고지. */
  note: string;
}

/** 판정 결과(수용기준 2). */
export interface EditionDensityVerdict {
  /** 매수등급 중앙값 < 임계(2). */
  medianBelowThreshold: boolean;
  /** 매수등급 0건일 비율 > 임계(0.40). */
  zeroDayRatioAboveThreshold: boolean;
  /** 폴백 스코프 제안서 트리거(위 둘 중 하나라도 참). */
  fallbackProposalTriggered: boolean;
  /** 적용 임계(정직 고지). */
  thresholds: typeof EDITION_DENSITY_THRESHOLDS;
  /** 트리거 시 오너 판정에 회부할 폴백 제안서 경로. */
  proposalDoc: string;
  /** 판정 요약(한국어, 사람이 읽는 한 줄). */
  summary: string;
}

/** 에디션 밀도 실측 리포트. */
export interface EditionDensityReport {
  metric: 'edition-signal-density';
  /** '에디션 신호' 정의(정직성 계약) — 무엇을 1건으로 세는지. */
  definition: string;
  /** 집계 거래일 수(요청/유효 N, 기본 60). */
  windowTradingDays: number;
  /** 윈도 종료 거래일(최근 '완료된' 거래일, YYYYMMDD). */
  anchorEndDate: string;
  /** 윈도 시작 거래일(YYYYMMDD). */
  oldestDate: string;
  /** KST 오늘 거래일(YYYYMMDD). */
  todayDate: string;
  /**
   * 오늘이 윈도에 포함됐는지. false면 오늘의 미완료 에디션(19:15 KST 전)을 제외해
   * 0건일 비율 오염을 막았다는 뜻.
   */
  todayIncludedInWindow: boolean;
  generatedAt: string;
  /**
   * ★주계열: 매수등급 TradingSignal 원시 행 밀도(페르소나별 중복 포함).
   * DAR-553 이전 정의 그대로 유지(회귀 방지) — 해석 시 `buyGradeUniqueCorp` 병기 참조.
   */
  buyGrade: DensityStats;
  /** 보조계열: 전등급 신호 밀도(폴백 여지 진단). */
  allGrade: DensityStats;
  /**
   * DAR-553: 매수등급 신호를 corpCode 기준 dedup한 밀도(에디션이 실제 노출하는 카드 수).
   * `GET /signals/daily-editions`의 count 분포와 1:1 일치 — `buyGrade`(원시 행수)는
   * 페르소나 중복을 포함해 과대집계될 수 있으므로, "빈 신문" 여부의 정확한 해석은 이 계열을 우선한다.
   */
  buyGradeUniqueCorp: DensityStats;
  /** 판정(수용기준 2). */
  verdict: EditionDensityVerdict;
  /** 분모 교차검증(정직성). */
  tradingDayCrossCheck: TradingDayCrossCheck;
  /** 거래일별 상세(최신 우선). */
  daily: DensityDailyRow[];
}
