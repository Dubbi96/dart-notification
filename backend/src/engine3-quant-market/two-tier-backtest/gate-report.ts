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
 * 트랙 1개 게이트 지표 산출.
 *
 * @param result           트랙 백테스트 결과.
 * @param benchmarkReturnPct 벤치마크(매수후보유) 수익률%.
 * @param opts.minTrades   LOW_SAMPLE 임계(이 미만이면 검증력 부족 판정). 기본 20.
 * @param opts.lowPowerNote 트랙 특성 정직 라벨(코어: 월단위 관측 12회/년 등).
 */
export function buildTrackGateMetrics(
  result: TrackBacktestResult,
  benchmarkReturnPct: number,
  opts: { minTrades?: number; lowPowerNote?: string } = {},
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

  const edgePositive = totalReturnPct > 0 && totalReturnPct > benchmarkReturnPct;

  let verdict: GateVerdict;
  if (totalTrades < minTrades) verdict = 'LOW_SAMPLE';
  else verdict = edgePositive ? 'EDGE_POSITIVE' : 'NO_EDGE';

  const baseNote = `표본 ${totalTrades}건(거래) / 판정 ${result.sampleCount}회 · totalReturn ${totalReturnPct.toFixed(
    2,
  )}% vs 벤치마크 ${benchmarkReturnPct.toFixed(2)}%`;
  const note = opts.lowPowerNote ? `${baseNote} · ${opts.lowPowerNote}` : baseNote;

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
