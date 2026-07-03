/**
 * backtest-forward-divergence.ts — 백테스트 vs forward 성과 괴리 산출: 순수 함수 (견고화 W0·P04, DAR-479)
 *
 * ★배경(갭 E4 partial): 리플레이 트랙(BacktestRun.strategyKey, 과거 1년 재생)과 forward 트랙
 *   (styleTag='strategy:<key>', 오늘 신호→오늘 진입 누적)은 그간 "별개 표면"으로 조인이 없었다.
 *   졸업 판정의 핵심 지표(백테스트 대비 실운용 괴리)를 strategyKey 로 조인해 산출한다.
 *
 * 산출 지표(4종): 수익률·승률·거래빈도·보유기간. 각 지표의 괴리 = forward − backtest.
 *
 * ★★ 정의 재사용(중복 정의 금지):
 *   - 승률: engine5 `trade-scorecard.ts` `calculateTradeScorecard`(승률 = 순손익>0 / 전체 청산,
 *     본전은 분모만) 와 engine3 `metrics/performance-calculator` 가 이미 통일한 정의(0~1)를 그대로
 *     소비한다 — 여기서 재계산하지 않는다.
 *   - 신호 레벨 gap: engine3 `backtest/calibration.ts` 의 gap 의미론(gap = 실측 − 기대, |gap|<ε 이면
 *     ALIGNED, 표본 부족/미산출은 HOLD 로 판정 보류)을 지표 괴리에 계승한다(LOW_SAMPLE ≈ HOLD).
 *
 * ★ read-only 산술/매핑만 — 신규 수집·외부호출·AI 개입 0. 트레이딩 행동(매수·체결·청산) 무접촉.
 *   service 가 backtest/forward 성과를 읽어 넘기면 여기서는 받은 값만 괴리로 변환한다(side-effect 0).
 *   표본 부족(기존 임계 미만)은 LOW_SAMPLE 로 정직 표기해 과신을 방지한다.
 */

/** 월 환산(거래빈도 정규화) 기준 일수 — 백테스트 창/포워드 운용기간을 동일 척도로 비교. */
export const TRADES_PER_MONTH_WINDOW_DAYS = 30;

/**
 * 지표별 괴리 판정 임계(|gap| 이 미만이면 ALIGNED). calibration.ts CALIBRATION_GAP_EPSILON 패턴 —
 * 미세한 차이를 '괴리'로 과잉경보하지 않는다. ★사람 검토 대상 투명 상수(자동 튜닝 없음).
 */
export const DIVERGENCE_EPSILON = {
  /** 수익률 %p */
  returnPct: 5,
  /** 승률(0~1 비율 차) */
  winRate: 0.1,
  /** 월 환산 거래빈도(건 차) */
  tradesPerMonth: 2,
  /** 보유일수(일 차) */
  holdDays: 3,
} as const;

/** 괴리 판정 상태 — calibration.ts CalibrationStatus 의미론 계승. LOW_SAMPLE ≈ HOLD(판정 보류). */
export type DivergenceStatus = 'ALIGNED' | 'DIVERGED' | 'LOW_SAMPLE';

/** 비교 지표 4종 식별자. */
export type DivergenceMetricKey = 'return' | 'winRate' | 'tradeFrequency' | 'holdDays';

/** 지표 1종의 한 축(backtest 또는 forward) 값 묶음. */
export interface DivergenceTrackMetrics {
  /** 누적 수익률(%). 표본 0/미산출이면 null. */
  returnPct: number | null;
  /** 승률(0~1, 통일 정의). 표본 0이면 null. */
  winRate: number | null;
  /** 평균 보유일수. 산출 표본 0이면 null. */
  avgHoldDays: number | null;
  /** 월 환산 거래빈도(건). 산출불가(운용기간 0 등)면 null. */
  tradesPerMonth: number | null;
  /** 청산 완료 표본 수(빈도·과신 판정 근거). */
  sampleSize: number;
}

/** 지표 1종 괴리 행. */
export interface MetricDivergence {
  metric: DivergenceMetricKey;
  /** 화면 표기 라벨(한국어). */
  label: string;
  /** 단위(%, 배지 표기용). */
  unit: string;
  backtest: number | null;
  forward: number | null;
  /** forward − backtest. 한쪽이라도 null 이면 null. */
  gap: number | null;
  status: DivergenceStatus;
  /** 사람용 근거(판정 사유). */
  reason: string;
}

/** 전략 1종의 괴리 묶음(4지표). */
export interface StrategyDivergence {
  key: string;
  label: string;
  /** 한 줄 컨셉(preset.description). */
  tagline: string;
  backtestSampleSize: number;
  forwardSampleSize: number;
  /** 백테스트 트랙 산출 여부(표본>0). */
  hasBacktest: boolean;
  /** forward 트랙 산출 여부(표본>0). */
  hasForward: boolean;
  /** 표본 부족 — backtest 또는 forward 표본이 기존 임계 미만(과신 방지). */
  lowSample: boolean;
  metrics: MetricDivergence[];
  /** 지표 중 하나라도 DIVERGED 면 true(요약 배지). lowSample 이면 판정 보류로 false. */
  diverged: boolean;
  /** 원천 축 값(스냅샷 적재용 — service 가 그대로 영속). */
  backtest: DivergenceTrackMetrics;
  forward: DivergenceTrackMetrics;
}

/** 소수 둘째자리 반올림(결정론·표시 안정성). null 보존. */
function round2(v: number | null): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  return Math.round(v * 100) / 100;
}

/**
 * 거래빈도 월 환산(순수 함수): tradeCount / spanDays × 30. 운용기간(spanDays) 0 이하면 null.
 * ★ backtest(리플레이 창 일수)·forward(첫~마지막 스냅샷 일수) 를 동일 척도로 정규화한다.
 */
export function computeTradesPerMonth(
  tradeCount: number,
  spanDays: number,
): number | null {
  if (!(spanDays > 0)) return null;
  return round2((tradeCount / spanDays) * TRADES_PER_MONTH_WINDOW_DAYS);
}

/** 두 날짜(YYYYMMDD 문자열) 사이의 달력 일수(포함, 최소 1). 산출불가면 null. */
export function spanDaysBetween(
  startYmd: string | null,
  endYmd: string | null,
): number | null {
  if (!startYmd || !endYmd) return null;
  const s = parseYmd(startYmd);
  const e = parseYmd(endYmd);
  if (s === null || e === null) return null;
  const ms = e - s;
  if (ms < 0) return null;
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)) + 1);
}

/** YYYYMMDD 또는 YYYY-MM-DD → epoch ms(UTC 자정). 파싱 실패 null. */
function parseYmd(ymd: string): number | null {
  const compact = ymd.replace(/-/g, '');
  if (!/^\d{8}$/.test(compact)) return null;
  const y = Number(compact.slice(0, 4));
  const m = Number(compact.slice(4, 6));
  const d = Number(compact.slice(6, 8));
  const t = Date.UTC(y, m - 1, d);
  return Number.isFinite(t) ? t : null;
}

/**
 * 지표 1종 괴리 판정(순수 함수). calibration.ts 판정 우선순위 계승:
 *  1) 한쪽 미산출 → LOW_SAMPLE(비교 보류)
 *  2) 표본 부족(lowSample) → LOW_SAMPLE(gap 은 참고로 산출하되 판정 보류)
 *  3) |gap| < ε → ALIGNED
 *  4) 그 외 → DIVERGED
 */
function metricDivergence(
  metric: DivergenceMetricKey,
  label: string,
  unit: string,
  backtest: number | null,
  forward: number | null,
  epsilon: number,
  lowSample: boolean,
): MetricDivergence {
  const base = { metric, label, unit, backtest, forward } as const;

  if (backtest === null || forward === null) {
    return {
      ...base,
      gap: null,
      status: 'LOW_SAMPLE',
      reason: '한쪽 트랙 지표 미산출 — 비교 보류',
    };
  }

  const gap = round2(forward - backtest);

  if (lowSample) {
    return {
      ...base,
      gap,
      status: 'LOW_SAMPLE',
      reason: '표본 부족 — 괴리 참고만(과신 방지)',
    };
  }

  if (gap !== null && Math.abs(gap) < epsilon) {
    return {
      ...base,
      gap,
      status: 'ALIGNED',
      reason: `정렬(|Δ|=${gap === null ? '?' : Math.abs(gap)} < ${epsilon})`,
    };
  }

  return {
    ...base,
    gap,
    status: 'DIVERGED',
    reason: `괴리(forward ${forward} vs backtest ${backtest}, Δ=${gap})`,
  };
}

/**
 * 전략 1종 괴리 산출(순수 함수). backtest/forward 성과를 받아 4지표 괴리 + 요약을 만든다.
 * lowSample = backtest 표본 < backtestLowSampleThreshold 또는 forward 표본 < forwardLowSampleThreshold
 * (기존 임계 준수 — backtest 20건·forward 5건). lowSample 이면 어떤 지표도 DIVERGED 로 판정하지 않는다.
 */
export function buildStrategyDivergence(input: {
  key: string;
  label: string;
  tagline: string;
  backtest: DivergenceTrackMetrics;
  forward: DivergenceTrackMetrics;
  backtestLowSampleThreshold: number;
  forwardLowSampleThreshold: number;
}): StrategyDivergence {
  const { key, label, tagline, backtest, forward } = input;

  const hasBacktest = backtest.sampleSize > 0;
  const hasForward = forward.sampleSize > 0;
  const lowSample =
    backtest.sampleSize < input.backtestLowSampleThreshold ||
    forward.sampleSize < input.forwardLowSampleThreshold;

  const metrics: MetricDivergence[] = [
    metricDivergence(
      'return',
      '수익률',
      '%',
      round2(backtest.returnPct),
      round2(forward.returnPct),
      DIVERGENCE_EPSILON.returnPct,
      lowSample,
    ),
    metricDivergence(
      'winRate',
      '승률',
      '비율',
      round2(backtest.winRate),
      round2(forward.winRate),
      DIVERGENCE_EPSILON.winRate,
      lowSample,
    ),
    metricDivergence(
      'tradeFrequency',
      '거래빈도(월 환산)',
      '건',
      round2(backtest.tradesPerMonth),
      round2(forward.tradesPerMonth),
      DIVERGENCE_EPSILON.tradesPerMonth,
      lowSample,
    ),
    metricDivergence(
      'holdDays',
      '평균 보유기간',
      '일',
      round2(backtest.avgHoldDays),
      round2(forward.avgHoldDays),
      DIVERGENCE_EPSILON.holdDays,
      lowSample,
    ),
  ];

  return {
    key,
    label,
    tagline,
    backtestSampleSize: backtest.sampleSize,
    forwardSampleSize: forward.sampleSize,
    hasBacktest,
    hasForward,
    lowSample,
    metrics,
    diverged: metrics.some((m) => m.status === 'DIVERGED'),
    backtest,
    forward,
  };
}

/** 지표 키로 괴리 행 조회(스냅샷 적재 매핑용). 없으면 null. */
export function findMetric(
  divergence: StrategyDivergence,
  metric: DivergenceMetricKey,
): MetricDivergence | null {
  return divergence.metrics.find((m) => m.metric === metric) ?? null;
}

/** ★ 자동 튜닝 금지 고지(측정·관측 전용). */
export const DIVERGENCE_DISCLAIMER =
  '이 리포트는 읽기 전용 측정입니다. 백테스트(리플레이)와 forward(실운용 누적)의 괴리를 관측할 뿐, ' +
  '전략 파라미터·임계값·매매 행동을 자동으로 변경하지 않습니다. 표본 부족(LOW_SAMPLE)은 판정을 보류합니다.';
