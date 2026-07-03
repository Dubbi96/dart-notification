import { StrategyParams, PerformanceMetrics } from '../ports/backtest.types';

/**
 * parameter-sweep.ts — 전략 파라미터 민감도 스윕: 순수 그리드·안정성 리포트 함수 (DAR-485)
 *
 * ★배경(견고화 W3·P24, 갭 B3 / 룰북 §9-1 과최적화 대응): 손절/익절/보유일/임계점수의 '이웃'
 *   파라미터 값에서도 성과가 유지되는지(파라미터 고원 plateau 위에 앉아 있는지)를 확인하는 장치가
 *   전무했다. 프리셋 4종 비교·피처 A/B(signal-feature-ab.ts)는 파라미터 '이웃 탐색'이 아니다.
 *   이 모듈은 프리셋 파라미터를 축별로 ±스텝 만큼 흔든(one-at-a-time) 이웃값 그리드에서 성과가
 *   급변하는지 측정한다. 급변하면 그 프리셋은 과최적화(스파이크)일 가능성이 높다.
 *
 * ★★ AI 자동 파라미터 조정 절대 금지(불가침): 이 하니스는 오직 측정·리포트만 한다. 결과를 근거로
 *   파라미터를 자동 변경하는 코드는 존재하지 않으며, 추가해서도 안 된다. 리포트의 파라미터 반영은
 *   반드시 `docs/trading/strategy-rulebook.md §8 변경 절차`(문서 개정 → 재검증 → 사람 승인)로만 한다.
 *   코드는 문서를 앞서지 않는다.
 *
 * ★ read-only — I/O·외부호출·AI·파라미터 자동변경 0. 이 파일은 넘겨받은 StrategyParams 를 순수
 *   산술로 변형해 이웃 파라미터 집합을 만들고, 실행부가 넘긴 PerformanceMetrics 만 비교한다.
 *   실제 백테스트 실행(러너 재사용)·신호 조립은 parameter-sweep.service.ts 가 담당한다.
 *
 * 설계 원칙:
 *  - one-at-a-time(OAT): 한 번에 한 축만 흔든다(나머지는 프리셋 baseline 고정). 각 축의 민감도를
 *    교란 없이 격리한다. 전 조합(Cartesian)은 실행량이 폭증(3^n)하고 해석이 어렵다.
 *  - 프리셋 키 기반 일반화: 축은 표준 StrategyParams 필드(손절·익절·보유일·minBuyScore)를 읽는다.
 *    신규 트랙(P12 듀얼모멘텀 룩백·P14 변동성돌파 K값)이 머지되면 StrategyParams 확장 후 SWEEP_AXES 에
 *    항목만 추가하면 동일 하니스가 프리셋 키만으로 적용된다.
 */

/** 스윕 축 식별자. 신규 파라미터 축은 여기에 추가한다(P12 룩백·P14 K값 등). */
export type SweepAxisKey = 'stopLoss' | 'takeProfit' | 'holdDays' | 'minBuyScore';

/** 스윕 이웃 방향. baseline=프리셋 원값(중심), down/up=원값 ∓/± 스텝. */
export type SweepDirection = 'baseline' | 'down' | 'up';

/**
 * 안정성 판정(1차 지표 totalReturn 기준, 축별). 최악순: FRAGILE > SENSITIVE > MODERATE > STABLE.
 * LOW_SAMPLE=baseline 표본 부족(과최적화 판단 불가). FRAGILE=이웃이 수익 부호를 뒤집음(가장 취약).
 */
export type SweepVerdict = 'STABLE' | 'MODERATE' | 'SENSITIVE' | 'FRAGILE' | 'LOW_SAMPLE';

export const SWEEP_VERDICT_LABEL: Record<SweepVerdict, string> = {
  STABLE: '안정(이웃 성과 유지)',
  MODERATE: '보통(중간 변동)',
  SENSITIVE: '민감(성과 급변)',
  FRAGILE: '취약(이웃이 손익 부호를 뒤집음)',
  LOW_SAMPLE: '표본부족(판단보류)',
};

/**
 * 축별 이웃 스텝(과제 정의): 손절 ±2%p · 익절 ±5%p · 보유일 ±5일 · minBuyScore ±5.
 * ★ 상수 — AI 로 조정하지 않는다. 스텝 변경은 룰북 §8 변경 절차를 따른다.
 */
export const SWEEP_STEPS = {
  stopLoss: 2,
  takeProfit: 5,
  holdDays: 5,
  minBuyScore: 5,
} as const satisfies Record<SweepAxisKey, number>;

/**
 * 표본이 이 청산 거래 수 미만이면 승률·수익률이 통계적으로 빈약 → 안정성 판단 보류(LOW_SAMPLE).
 * strategy-track.service.ts 의 LOW_SAMPLE_TRADES(20)와 동일한 근거(1년 트랙 정상 전략은 수십 건+).
 * 결합을 피해 여기서 상수로 재선언한다(순수 모듈은 서비스 import 0).
 */
export const SWEEP_LOW_SAMPLE_TRADES = 20;

/**
 * 1차 지표(totalReturn, %p) 절대 변동이 이 값 미만이면 실질적으로 '변동 없음'으로 본다.
 * 0 근처 baseline 에서 상대변동이 폭발하는 잡음을 흡수한다.
 */
export const SWEEP_MIN_MEANINGFUL_SWING = 3;

/**
 * 상대변동 분모 하한(%p). |baseline| 이 이보다 작으면 이 값으로 나눠 0-나눗셈/폭발을 막는다.
 */
export const SWEEP_REL_DENOM_FLOOR = 5;

/** 부호 뒤집힘(FRAGILE) 판정 시 양쪽 |totalReturn| 모두 이 값 이상이어야 함(0 근처 잡음 배제). */
export const SWEEP_SIGN_FLIP_MIN_MAGNITUDE = 3;

/** 상대변동 임계: 이상이면 SENSITIVE. */
export const SWEEP_SENSITIVE_REL = 0.5;
/** 상대변동 임계: 이상이면 MODERATE(SENSITIVE 미만). */
export const SWEEP_MODERATE_REL = 0.25;

/** 한 스윕 축의 정의(get/set/clamp 는 순수). */
export interface SweepAxis {
  key: SweepAxisKey;
  /** 화면/리포트 표기용 한국어 라벨. */
  label: string;
  /** 단위 표기(%p·일·점). */
  unit: string;
  /** 이웃 스텝(±). */
  step: number;
  /** baseline 파라미터에서 이 축의 현재값을 읽는다. */
  get(params: StrategyParams): number;
  /** 이 축을 value 로 바꾼 새 StrategyParams 를 만든다(불변 — 원본 미변경). */
  set(params: StrategyParams, value: number): StrategyParams;
  /** 유효 도메인으로 clamp(예: 보유일 ≥1 정수, 익절 >0, 손절 <0). */
  clamp(value: number): number;
}

/**
 * 표준 4축. one-at-a-time 으로 각각 흔든다.
 * ★ 신규 파라미터 축(P12 룩백·P14 K값)은 StrategyParams 확장 후 이 배열에 SweepAxis 항목을 추가한다.
 *   그러면 프리셋 키만 알면 동일 하니스(그리드+리포트)가 자동 적용된다.
 */
export const SWEEP_AXES: readonly SweepAxis[] = [
  {
    key: 'stopLoss',
    label: '손절',
    unit: '%p',
    step: SWEEP_STEPS.stopLoss,
    get: (p) => p.exitRules.stopLossPct,
    set: (p, v) => ({ ...p, exitRules: { ...p.exitRules, stopLossPct: v } }),
    // 손절은 손실 임계 — 음수 유지(≤ -1). 0 이상이면 진입 즉시 손절되는 퇴행값이므로 배제.
    clamp: (v) => Math.min(-1, Math.round(v * 100) / 100),
  },
  {
    key: 'takeProfit',
    label: '익절',
    unit: '%p',
    step: SWEEP_STEPS.takeProfit,
    get: (p) => p.exitRules.takeProfitPct,
    set: (p, v) => ({ ...p, exitRules: { ...p.exitRules, takeProfitPct: v } }),
    // 익절은 이익 임계 — 양수 유지(≥1).
    clamp: (v) => Math.max(1, Math.round(v * 100) / 100),
  },
  {
    key: 'holdDays',
    label: '최대보유일',
    unit: '일',
    step: SWEEP_STEPS.holdDays,
    get: (p) => p.exitRules.maxHoldDays,
    set: (p, v) => ({ ...p, exitRules: { ...p.exitRules, maxHoldDays: v } }),
    // 보유일은 양의 정수(≥1).
    clamp: (v) => Math.max(1, Math.round(v)),
  },
  {
    key: 'minBuyScore',
    label: '최소매수점수',
    unit: '점',
    step: SWEEP_STEPS.minBuyScore,
    get: (p) => p.minBuyScore,
    set: (p, v) => ({ ...p, minBuyScore: v }),
    // 매수점수 임계는 0 이상.
    clamp: (v) => Math.max(0, Math.round(v)),
  },
] as const;

/** 그리드 1점: 어느 축을 어느 방향으로 흔든 파라미터 집합인가. */
export interface SweepPoint {
  axisKey: SweepAxisKey | 'baseline';
  axisLabel: string;
  direction: SweepDirection;
  /** 이 점에서 흔든 축의 값(clamp 후). baseline 은 원값. */
  paramValue: number;
  /** 실행부(러너)에 그대로 주입할 완전한 파라미터. */
  params: StrategyParams;
}

/**
 * baseline + 축별 이웃(down/up) 그리드를 만든다(OAT).
 * clamp 후 원값과 같아지는 이웃은 정보가 없으므로 제외한다(중복 실행 회피).
 * 순수 — 원본 base 를 변경하지 않는다.
 */
export function buildSweepGrid(
  base: StrategyParams,
  axes: readonly SweepAxis[] = SWEEP_AXES,
): SweepPoint[] {
  const points: SweepPoint[] = [
    { axisKey: 'baseline', axisLabel: '프리셋 원값', direction: 'baseline', paramValue: NaN, params: base },
  ];

  for (const axis of axes) {
    const baseValue = axis.get(base);
    if (!Number.isFinite(baseValue)) continue; // 이 프리셋에 해당 축이 없으면 skip

    const candidates: Array<{ direction: Exclude<SweepDirection, 'baseline'>; raw: number }> = [
      { direction: 'down', raw: baseValue - axis.step },
      { direction: 'up', raw: baseValue + axis.step },
    ];

    for (const c of candidates) {
      const value = axis.clamp(c.raw);
      if (value === baseValue) continue; // clamp 로 원값과 동일 → 정보 없음
      points.push({
        axisKey: axis.key,
        axisLabel: axis.label,
        direction: c.direction,
        paramValue: value,
        params: axis.set(base, value),
      });
    }
  }

  return points;
}

/** 리포트에 담는 성과 지표 스냅샷(PerformanceMetrics 의 견고성 관련 부분집합). */
export interface SweepMetricSnapshot {
  /** 누적 수익률(%). 1차 안정성 판정 지표. */
  totalReturn: number;
  /** 승률(%). */
  winRate: number;
  /** Profit Factor. 비유한(Infinity 등)은 null. */
  profitFactor: number | null;
  /** 최대낙폭 MDD(%, ≤0). */
  mdd: number;
  /** Sharpe. 비유한은 null. */
  sharpe: number | null;
  /** 청산 완료 거래 수(표본). */
  totalTrades: number;
}

/** 유한이면 그대로, 아니면 null(Infinity/NaN 방어 — JSON 직렬화 안전). */
function finiteOrNull(v: number): number | null {
  return Number.isFinite(v) ? v : null;
}

/** PerformanceMetrics → 스윕 스냅샷. */
export function toSweepSnapshot(m: PerformanceMetrics): SweepMetricSnapshot {
  return {
    totalReturn: Number.isFinite(m.totalReturn) ? m.totalReturn : 0,
    winRate: Number.isFinite(m.winRate) ? m.winRate : 0,
    profitFactor: finiteOrNull(m.profitFactor),
    mdd: Number.isFinite(m.mdd) ? m.mdd : 0,
    sharpe: finiteOrNull(m.sharpe),
    totalTrades: m.totalTrades,
  };
}

/** 리포트에 노출하는 지표 목록(순서 고정)과 라벨. */
export const SWEEP_TRACKED_METRICS: ReadonlyArray<{ key: keyof SweepMetricSnapshot; label: string }> = [
  { key: 'totalReturn', label: '누적수익률(%)' },
  { key: 'winRate', label: '승률(%)' },
  { key: 'profitFactor', label: 'Profit Factor' },
  { key: 'mdd', label: 'MDD(%)' },
  { key: 'sharpe', label: 'Sharpe' },
  { key: 'totalTrades', label: '거래수' },
];

/** 한 지표의 baseline↔이웃(down/up) 값·델타. */
export interface AxisMetricRow {
  metric: keyof SweepMetricSnapshot;
  label: string;
  baseline: number | null;
  down: number | null;
  up: number | null;
  /** down − baseline. 한쪽이라도 null 이면 null. */
  downDelta: number | null;
  /** up − baseline. */
  upDelta: number | null;
  /** max(|downDelta|, |upDelta|). 이웃 없거나 전부 null 이면 null. */
  maxAbsSwing: number | null;
}

/** 한 축의 안정성 결과. */
export interface AxisStability {
  axisKey: SweepAxisKey;
  axisLabel: string;
  unit: string;
  step: number;
  /** 축의 baseline 파라미터 값. */
  baselineParam: number;
  /** down/up 이웃 파라미터 값(clamp 로 제외됐으면 null). */
  downParam: number | null;
  upParam: number | null;
  /** 지표별 baseline↔이웃 표. */
  metrics: AxisMetricRow[];
  /** 1차 지표(totalReturn) 절대 변동(%p). */
  primaryAbsSwing: number | null;
  /** 1차 지표 상대 변동(maxAbsSwing / max(|baseline|, floor)). */
  primaryRelSwing: number | null;
  /** 이웃이 totalReturn 부호를 뒤집었는가(양쪽 |값| ≥ 최소치). */
  signFlip: boolean;
  verdict: SweepVerdict;
}

/** 파라미터 민감도 스윕 리포트(read-only 측정 산출물). */
export interface ParameterSweepReport {
  presetKey: string;
  presetLabel: string;
  window: { startDate: string; endDate: string };
  /** 프리셋 원값 성과. */
  baseline: SweepMetricSnapshot;
  /** baseline 청산 표본(안정성 판단 가능 여부). */
  baselineTrades: number;
  /** 전체 실행 파라미터 집합 수(baseline 포함). */
  gridSize: number;
  /** 축별 안정성. */
  axes: AxisStability[];
  /** 1차 지표 상대변동이 가장 큰 축(표본 충분 시). 없으면 null. */
  mostSensitiveAxisKey: SweepAxisKey | null;
  /** 전 축 최악 판정(baseline 표본 부족이면 LOW_SAMPLE). */
  overallVerdict: SweepVerdict;
  /** baseline 표본 부족 여부. */
  lowSample: boolean;
  /**
   * ★ 리포트의 파라미터 반영은 룰북 §8 변경 절차로만. AI 자동 조정 금지. 이 문자열을 응답에 담아
   *   소비자(API/스크립트 사용자)에게 제약을 상기시킨다.
   */
  notice: string;
}

export const SWEEP_READONLY_NOTICE =
  'read-only 측정 리포트. 파라미터 자동 조정 없음. 값 반영은 docs/trading/strategy-rulebook.md §8 변경 절차(문서 개정→재검증→사람 승인)로만.';

/** null-안전 뺄셈(a−b). 한쪽이라도 null 이면 null. */
function nullableDiff(a: number | null, b: number | null): number | null {
  if (a === null || b === null) return null;
  return a - b;
}

/** 한 지표에 대해 baseline↔(down/up) 행을 만든다. */
function buildMetricRow(
  metric: keyof SweepMetricSnapshot,
  label: string,
  baseline: SweepMetricSnapshot,
  down: SweepMetricSnapshot | null,
  up: SweepMetricSnapshot | null,
): AxisMetricRow {
  const b = baseline[metric];
  const d = down ? down[metric] : null;
  const u = up ? up[metric] : null;
  const downDelta = nullableDiff(d, b);
  const upDelta = nullableDiff(u, b);
  const swings = [downDelta, upDelta].filter((x): x is number => x !== null).map(Math.abs);
  return {
    metric,
    label,
    baseline: b,
    down: d,
    up: u,
    downDelta,
    upDelta,
    maxAbsSwing: swings.length > 0 ? Math.max(...swings) : null,
  };
}

/** 축 하나의 안정성 판정(순수). baseline 표본 부족 시 LOW_SAMPLE. */
function assessAxis(
  axis: SweepAxis,
  base: StrategyParams,
  baseline: SweepMetricSnapshot,
  baselineTrades: number,
  down: { param: number; snapshot: SweepMetricSnapshot } | null,
  up: { param: number; snapshot: SweepMetricSnapshot } | null,
): AxisStability {
  const metrics = SWEEP_TRACKED_METRICS.map(({ key, label }) =>
    buildMetricRow(key, label, baseline, down?.snapshot ?? null, up?.snapshot ?? null),
  );

  // 1차 지표(totalReturn) 기준 변동·부호뒤집힘.
  const baseReturn = baseline.totalReturn;
  const neighborReturns = [down?.snapshot.totalReturn, up?.snapshot.totalReturn].filter(
    (x): x is number => typeof x === 'number' && Number.isFinite(x),
  );

  let primaryAbsSwing: number | null = null;
  for (const r of neighborReturns) {
    const swing = Math.abs(r - baseReturn);
    primaryAbsSwing = primaryAbsSwing === null ? swing : Math.max(primaryAbsSwing, swing);
  }

  const primaryRelSwing =
    primaryAbsSwing === null
      ? null
      : primaryAbsSwing / Math.max(Math.abs(baseReturn), SWEEP_REL_DENOM_FLOOR);

  const signFlip = neighborReturns.some(
    (r) =>
      Math.sign(r) !== Math.sign(baseReturn) &&
      Math.abs(r) >= SWEEP_SIGN_FLIP_MIN_MAGNITUDE &&
      Math.abs(baseReturn) >= SWEEP_SIGN_FLIP_MIN_MAGNITUDE,
  );

  const verdict = classifyAxis(baselineTrades, primaryAbsSwing, primaryRelSwing, signFlip);

  return {
    axisKey: axis.key,
    axisLabel: axis.label,
    unit: axis.unit,
    step: axis.step,
    baselineParam: axis.get(base),
    downParam: down?.param ?? null,
    upParam: up?.param ?? null,
    metrics,
    primaryAbsSwing,
    primaryRelSwing,
    signFlip,
    verdict,
  };
}

/** 축 판정 규칙(순수). */
export function classifyAxis(
  baselineTrades: number,
  primaryAbsSwing: number | null,
  primaryRelSwing: number | null,
  signFlip: boolean,
): SweepVerdict {
  if (baselineTrades < SWEEP_LOW_SAMPLE_TRADES) return 'LOW_SAMPLE';
  if (signFlip) return 'FRAGILE';
  if (primaryAbsSwing === null || primaryRelSwing === null) return 'STABLE'; // 흔들 이웃 없음 → 안정
  if (primaryAbsSwing < SWEEP_MIN_MEANINGFUL_SWING) return 'STABLE'; // 절대 변동 미미
  if (primaryRelSwing >= SWEEP_SENSITIVE_REL) return 'SENSITIVE';
  if (primaryRelSwing >= SWEEP_MODERATE_REL) return 'MODERATE';
  return 'STABLE';
}

/** 판정 최악순 서열(overall roll-up 용). */
const VERDICT_SEVERITY: Record<SweepVerdict, number> = {
  STABLE: 0,
  MODERATE: 1,
  SENSITIVE: 2,
  FRAGILE: 3,
  LOW_SAMPLE: 0, // baseline 표본부족은 overall 에서 별도 처리
};

/** 실행부가 넘긴 (point, metrics) 결과로 안정성 리포트를 조립한다(순수). */
export function buildSweepReport(params: {
  presetKey: string;
  presetLabel: string;
  window: { startDate: string; endDate: string };
  base: StrategyParams;
  /** buildSweepGrid 가 만든 각 점 + 그 점의 성과 스냅샷(baseline 포함). */
  results: Array<{ point: SweepPoint; snapshot: SweepMetricSnapshot }>;
  axes?: readonly SweepAxis[];
}): ParameterSweepReport {
  const axes = params.axes ?? SWEEP_AXES;

  const baselineResult = params.results.find((r) => r.point.direction === 'baseline');
  if (!baselineResult) {
    throw new Error('buildSweepReport: baseline 결과가 없습니다(그리드 무결성 위반).');
  }
  const baseline = baselineResult.snapshot;
  const baselineTrades = baseline.totalTrades;
  const lowSample = baselineTrades < SWEEP_LOW_SAMPLE_TRADES;

  // 축·방향으로 결과 색인.
  const byAxisDir = new Map<string, { point: SweepPoint; snapshot: SweepMetricSnapshot }>();
  for (const r of params.results) {
    if (r.point.direction === 'baseline') continue;
    byAxisDir.set(`${r.point.axisKey}:${r.point.direction}`, r);
  }

  const axisStabilities: AxisStability[] = axes
    .filter((axis) => Number.isFinite(axis.get(params.base)))
    .map((axis) => {
      const downR = byAxisDir.get(`${axis.key}:down`);
      const upR = byAxisDir.get(`${axis.key}:up`);
      return assessAxis(
        axis,
        params.base,
        baseline,
        baselineTrades,
        downR ? { param: downR.point.paramValue, snapshot: downR.snapshot } : null,
        upR ? { param: upR.point.paramValue, snapshot: upR.snapshot } : null,
      );
    });

  // 가장 민감한 축(표본 충분 시 상대변동 최대). 표본 부족이면 판단 불가 → null.
  let mostSensitiveAxisKey: SweepAxisKey | null = null;
  if (!lowSample) {
    let maxRel = -Infinity;
    for (const a of axisStabilities) {
      if (a.primaryRelSwing !== null && a.primaryRelSwing > maxRel) {
        maxRel = a.primaryRelSwing;
        mostSensitiveAxisKey = a.axisKey;
      }
    }
  }

  // overall = 표본 부족이면 LOW_SAMPLE, 아니면 축 최악 판정.
  let overallVerdict: SweepVerdict;
  if (lowSample) {
    overallVerdict = 'LOW_SAMPLE';
  } else {
    overallVerdict = axisStabilities.reduce<SweepVerdict>(
      (worst, a) => (VERDICT_SEVERITY[a.verdict] > VERDICT_SEVERITY[worst] ? a.verdict : worst),
      'STABLE',
    );
  }

  return {
    presetKey: params.presetKey,
    presetLabel: params.presetLabel,
    window: params.window,
    baseline,
    baselineTrades,
    gridSize: params.results.length,
    axes: axisStabilities,
    mostSensitiveAxisKey,
    overallVerdict,
    lowSample,
    notice: SWEEP_READONLY_NOTICE,
  };
}
