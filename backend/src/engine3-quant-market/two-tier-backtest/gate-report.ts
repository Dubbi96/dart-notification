// Engine3 — 백테스트 엣지 게이트 판정 리포트 (순수 함수, DAR-493 [견고화 W1·P16])
//
// 신규 2트랙(코어·위성) 백테스트 결과 → 트랙별 성과지표 + **엣지 양수 여부**(비용 반영 후
// totalReturn>0 && 벤치마크 대비 우위) + 표본·통계 검증력 정직 라벨.
//
// ★게이트 판정과 forward 활성 결정은 통합자·사용자 소관(§5 검증 게이트 1관문). 이 리포트는 입력이다.
// ★AI 자동 파라미터 조정 금지 — 불합격 시 튜닝은 룰북 §8 절차(문서 개정→재검증→사람 승인)로만.

import { DatedBar, TrackBacktestResult } from './two-tier-backtest.types';
import { ETF_COST_PROFILE, applySlippage } from './etf-cost-profile';
import { BacktestCostParams } from '../backtest/ports/backtest.types';

export type GateVerdict = 'EDGE_POSITIVE' | 'NO_EDGE' | 'LOW_SAMPLE';

/**
 * DAR-494 [P13]: 코어 한정 **위험조정** 게이트의 수익률 하한 계수(벤치마크 × 0.9).
 * 근거: GTAA 원전 목적(룰북 2-5) = 벤치마크와 유사 수익률 + MDD 축소. 게이트 실행 결과
 * 코어 +375.72%(벤치 +389.28%의 96.5%) · MDD -20.61%(벤치 -34.32% 대비 40% 개선)에 근거해
 * 사용자가 §8 사람 승인(2026-07-03)으로 코어 한정 기준 개정을 승인했다. 위성·기타 트랙은
 * 기존 엄격 기준(비용후>0 && >벤치) 유지 — 이 계수는 코어(riskAdjusted 옵션)에만 적용된다.
 */
export const RISK_ADJUSTED_RETURN_FLOOR = 0.9;

export interface TrackGateMetrics {
  styleTag: string;
  totalReturnPct: number;
  benchmarkReturnPct: number;
  winRatePct: number;
  /** 총이익/총손실. 손실 0 & 이익>0 이면 Infinity(JSON 직렬화 시 null). */
  profitFactor: number;
  mddPct: number; // ≤ 0
  sampleCount: number;
  totalTrades: number;
  avgHoldDays: number;
  edgePositive: boolean;
  verdict: GateVerdict;
  note: string;
}

export interface GateReport {
  core: TrackGateMetrics;
  satellite: TrackGateMetrics;
  /** 두 트랙 모두 엣지 양수여야 true(보수적 — do-no-harm). */
  overallEdgePositive: boolean;
  /** 활성 권고 — 항상 사람/통합자 결정임을 정직 고지. */
  activationNote: string;
}

/** 최대 낙폭(%) — 자산곡선 peak-to-trough. 반환값 ≤ 0. */
export function computeMaxDrawdownPct(equityCurve: readonly { equity: number }[]): number {
  let peak = -Infinity;
  let mdd = 0;
  for (const p of equityCurve) {
    if (p.equity > peak) peak = p.equity;
    if (peak > 0) {
      const dd = (p.equity - peak) / peak;
      if (dd < mdd) mdd = dd;
    }
  }
  return mdd * 100;
}

/**
 * 벤치마크 = 대상 자산 매수후보유(첫 바 시가 진입·마지막 바 종가 마크, ETF 비용 1회 반영) 수익률%.
 * @param bars  대상 자산 일봉(오름차순).
 * @param costs 비용 프로파일(기본 ETF).
 */
export function computeBuyHoldReturnPct(
  bars: readonly DatedBar[],
  costs: BacktestCostParams = ETF_COST_PROFILE,
): number {
  if (!bars || bars.length < 2) return 0;
  const first = bars[0];
  const last = bars[bars.length - 1];
  const entryPx = applySlippage(first.open, costs.slippagePct, true);
  const effEntry = entryPx * (1 + costs.commissionRate); // 진입 수수료 반영
  if (effEntry <= 0) return 0;
  // 마크는 종가(청산 비용 미반영 — 매수후보유는 미청산 마크투마켓, 트랙 자산곡선과 동일 규약).
  return (last.close / effEntry - 1) * 100;
}

/**
 * 벤치마크 매수후보유 **MDD**(%) — 종가 시계열 peak-to-trough. ≤ 0.
 * 코어 위험조정 게이트의 "MDD 개선(전략 MDD > 벤치마크 MDD)" 판정 입력.
 * (첫 바 시가 진입 여부와 무관하게 낙폭은 종가 궤적의 상대 낙폭이므로 종가 시계열로 산출한다.)
 */
export function computeBuyHoldMddPct(bars: readonly DatedBar[]): number {
  return computeMaxDrawdownPct(bars.map((b) => ({ equity: b.close })));
}

/**
 * 트랙 1개 게이트 지표 산출.
 *
 * @param result           트랙 백테스트 결과.
 * @param benchmarkReturnPct 벤치마크(매수후보유) 수익률%.
 * @param opts.minTrades   LOW_SAMPLE 임계(이 미만이면 검증력 부족 판정). 기본 20.
 * @param opts.lowPowerNote 트랙 특성 정직 라벨(코어: 월단위 관측 12회/년 등).
 * @param opts.riskAdjusted **코어 한정** 위험조정 게이트(DAR-494·§8 승인 2026-07-03). 지정 시 엣지 판정 =
 *   `비용후>0 && totalReturn ≥ 벤치마크×0.9 && 전략 MDD > 벤치마크 MDD`. 미지정(위성·기타)이면
 *   기존 엄격 기준(`비용후>0 && >벤치`) — 회귀 무변경. benchmarkMddPct 는 computeBuyHoldMddPct 결과(≤0).
 */
export function buildTrackGateMetrics(
  result: TrackBacktestResult,
  benchmarkReturnPct: number,
  opts: { minTrades?: number; lowPowerNote?: string; riskAdjusted?: { benchmarkMddPct: number } } = {},
): TrackGateMetrics {
  const minTrades = opts.minTrades ?? 20;
  const closed = result.trades.filter((t) => t.netPnl !== null);
  const totalTrades = closed.length;

  const wins = closed.filter((t) => (t.netPnl as number) > 0);
  const losses = closed.filter((t) => (t.netPnl as number) < 0);
  const winRatePct = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;

  const grossProfit = wins.reduce((s, t) => s + (t.netPnl as number), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.netPnl as number), 0));
  const profitFactor = grossLoss === 0 ? (grossProfit > 0 ? Number.POSITIVE_INFINITY : 0) : grossProfit / grossLoss;

  const mddPct = computeMaxDrawdownPct(result.equityCurve);
  const totalReturnPct = (result.finalEquity / result.initialCapital - 1) * 100;

  const holdDaysVals = closed.map((t) => t.holdDays ?? 0);
  const avgHoldDays = holdDaysVals.length > 0 ? holdDaysVals.reduce((a, b) => a + b, 0) / holdDaysVals.length : 0;

  // 엣지 판정: 기본(위성·기타)=엄격(비용후>0 && >벤치). 코어 위험조정(DAR-494·§8 승인)=
  //   비용후>0 && 수익률 ≥ 벤치×0.9 && MDD 개선(전략 MDD > 벤치 MDD, 둘 다 ≤0이므로 '>'=덜 깊음).
  const edgePositive = opts.riskAdjusted
    ? totalReturnPct > 0 &&
      totalReturnPct >= benchmarkReturnPct * RISK_ADJUSTED_RETURN_FLOOR &&
      mddPct > opts.riskAdjusted.benchmarkMddPct
    : totalReturnPct > 0 && totalReturnPct > benchmarkReturnPct;

  let verdict: GateVerdict;
  if (totalTrades < minTrades) verdict = 'LOW_SAMPLE';
  else verdict = edgePositive ? 'EDGE_POSITIVE' : 'NO_EDGE';

  const baseNote = `표본 ${totalTrades}건(거래) / 판정 ${result.sampleCount}회 · totalReturn ${totalReturnPct.toFixed(
    2,
  )}% vs 벤치마크 ${benchmarkReturnPct.toFixed(2)}%`;
  const riskAdjNote = opts.riskAdjusted
    ? ` · 위험조정 게이트(수익률≥벤치×${RISK_ADJUSTED_RETURN_FLOOR} && MDD ${mddPct.toFixed(2)}%>벤치 ${opts.riskAdjusted.benchmarkMddPct.toFixed(2)}%)`
    : '';
  const note = `${baseNote}${riskAdjNote}${opts.lowPowerNote ? ` · ${opts.lowPowerNote}` : ''}`;

  return {
    styleTag: result.styleTag,
    totalReturnPct,
    benchmarkReturnPct,
    winRatePct,
    profitFactor,
    mddPct,
    sampleCount: result.sampleCount,
    totalTrades,
    avgHoldDays,
    edgePositive,
    verdict,
    note,
  };
}

/**
 * 게이트 종합 리포트 조립.
 * @param core       코어 트랙 지표.
 * @param satellite  위성 트랙 지표.
 */
export function assembleGateReport(core: TrackGateMetrics, satellite: TrackGateMetrics): GateReport {
  const overallEdgePositive = core.edgePositive && satellite.edgePositive;
  return {
    core,
    satellite,
    overallEdgePositive,
    activationNote:
      'forward 활성은 통합자·사용자 결정이다(이 리포트는 입력·게이트 판정 근거). 코어는 월단위 관측(≈12회/년)으로 ' +
      '통계 검증력이 낮아 문헌 엣지 참조가 불가피하다(정직 고지). 불합격 시 파라미터 튜닝은 룰북 §8 절차로만.',
  };
}
