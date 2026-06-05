/**
 * 모의운용 누적 졸업지표 계산기 — 순수 Rule (M10 모의운용, DAR-40)
 *
 * cc-mvp-definition §9 go/no-go 게이트 4지표를 캘린더 누적 데이터로 산출한다:
 *   - 신호 적중률(D+5): BUY 신호 발생 후 D+5 수익률 > 0% 비율
 *   - 모의 누적 수익률: (현재 평가자산 - 초기 가상원금) / 초기 가상원금
 *   - Exit 정확도(D+3): EXIT 액션 발생 후 D+3 추가 하락 비율 (손절이 옳았는지)
 *   - AI비용/모의순익 비율: 총 AI비용(원) / 모의 순익(원)
 *
 * ★ 정직 표기 원칙(DAR-39 계승): 표본이 없으면 통과로 위장하지 않고 null을 반환한다.
 * AI 금지영역: 이 모듈은 산술 집계만 — 점수·체결·AI 결정 없음. AI 개입 0.
 */

/** 실현된 BUY 신호 1건의 D+5 결과 */
export interface SignalOutcome {
  /** 진입가 대비 D+5 종가 수익률(%). 아직 D+5 미도달이면 null(표본 제외) */
  d5ReturnPct: number | null;
}

/** 실현된 EXIT 1건의 D+3 결과 */
export interface ExitOutcome {
  /** EXIT 체결가 대비 D+3 종가 변화율(%). 음수면 손절이 옳았음. 미도달이면 null */
  d3ReturnPct: number | null;
}

export interface SimulationMetricsInput {
  /** 누적 BUY 신호들의 D+5 결과 */
  signalOutcomes: SignalOutcome[];
  /** 누적 EXIT 들의 D+3 결과 */
  exitOutcomes: ExitOutcome[];
  /** 초기 가상 원금(원) */
  initialCapital: number;
  /** 현재 평가자산(현금 + 보유 포지션 시가, 원) */
  currentEquity: number;
  /** 실현 순익 합계(원) — 청산된 모의매도 netPnl 합 */
  realizedNetPnl: number;
  /** 미실현 손익(원) — 보유 포지션 평가손익 합 */
  unrealizedPnl: number;
  /** 총 AI 비용(원, USD→KRW 환산 후) */
  totalAiCostKrw: number;
}

export interface SimulationMetrics {
  /** 신호 적중률(0~1). 표본 0이면 null */
  hitRateD5: number | null;
  hitRateSampleSize: number;
  /** 모의 누적 수익률(%) */
  cumulativeReturnPct: number;
  /** 총 모의 순익(원) = 실현 + 미실현 */
  netPnl: number;
  /** Exit 정확도(0~1) — D+3 추가 하락(=손절 적중) 비율. 표본 0이면 null */
  exitAccuracyD3: number | null;
  exitAccuracySampleSize: number;
  /** AI비용/모의순익 비율. 순익 ≤ 0 이면 측정 불가(null) */
  aiCostToNetPnlRatio: number | null;
  /** go/no-go 게이트 통과 여부 (표본 충분 + 목표 달성 시에만 true) */
  gates: {
    hitRatePass: boolean | null;       // ≥ 0.55
    cumulativeReturnPass: boolean;     // > 0
    exitAccuracyPass: boolean | null;  // ≥ 0.5
    aiCostRatioPass: boolean | null;   // ≤ 0.2
  };
}

/** 0으로 나누기/표본 부족을 안전 처리하는 순수 계산기 */
export function calculateSimulationMetrics(
  input: SimulationMetricsInput,
): SimulationMetrics {
  // 신호 적중률(D+5): D+5 도달한 표본만 집계
  const d5Realized = input.signalOutcomes.filter(
    (s): s is { d5ReturnPct: number } => s.d5ReturnPct !== null,
  );
  const hitRateSampleSize = d5Realized.length;
  const hitRateD5 =
    hitRateSampleSize > 0
      ? d5Realized.filter((s) => s.d5ReturnPct > 0).length / hitRateSampleSize
      : null;

  // Exit 정확도(D+3): EXIT 후 추가 하락(d3ReturnPct < 0)이면 손절이 옳았음
  const d3Realized = input.exitOutcomes.filter(
    (e): e is { d3ReturnPct: number } => e.d3ReturnPct !== null,
  );
  const exitAccuracySampleSize = d3Realized.length;
  const exitAccuracyD3 =
    exitAccuracySampleSize > 0
      ? d3Realized.filter((e) => e.d3ReturnPct < 0).length / exitAccuracySampleSize
      : null;

  // 누적 수익률
  const cumulativeReturnPct =
    input.initialCapital > 0
      ? ((input.currentEquity - input.initialCapital) / input.initialCapital) * 100
      : 0;

  const netPnl = input.realizedNetPnl + input.unrealizedPnl;

  // AI비용/순익 비율 — 순익이 0 이하면 측정 불가
  const aiCostToNetPnlRatio = netPnl > 0 ? input.totalAiCostKrw / netPnl : null;

  return {
    hitRateD5,
    hitRateSampleSize,
    cumulativeReturnPct,
    netPnl,
    exitAccuracyD3,
    exitAccuracySampleSize,
    aiCostToNetPnlRatio,
    gates: {
      hitRatePass: hitRateD5 === null ? null : hitRateD5 >= 0.55,
      cumulativeReturnPass: cumulativeReturnPct > 0,
      exitAccuracyPass: exitAccuracyD3 === null ? null : exitAccuracyD3 >= 0.5,
      aiCostRatioPass: aiCostToNetPnlRatio === null ? null : aiCostToNetPnlRatio <= 0.2,
    },
  };
}
