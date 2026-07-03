// Engine3 — 위성 변동성 돌파 일단위 백테스트 (순수 함수, DAR-493 [견고화 W1·P16])
//
// P14(volatility-breakout-signal) 판정·사이징 순수 함수 재사용. 일봉 근사:
//   진입 = 당일 고가 ≥ 목표가(장중 터치 근사) → 체결가 = max(목표가, 당일 시가)[갭 반영]
//   청산 = 익일 시가 전량(NEXT_OPEN). 사이징 = 변동성 조절(min(1, 목표변동성/전일Range%)).
//   추세필터 기본 OFF(§9.1 frozen). ETF 비용 프로파일(거래세 0) 적용.
//
// ★측정 트랙 무접촉·AI 개입 0. 게이트(엣지 양수) 계산용 측정 도구.

import { BacktestCostParams } from '../backtest/ports/backtest.types';
import {
  SATELLITE_TARGET_ETF_CODE,
  SATELLITE_STYLE_TAG,
  TARGET_DAILY_VOL_PCT,
} from '../volatility-breakout/volatility-breakout.constants';
import {
  OhlcBar,
  evaluateBreakoutEntry,
  computeVolAdjustedSizing,
  DEFAULT_BREAKOUT_ENTRY_PARAMS,
  BreakoutEntryParams,
} from '../volatility-breakout/volatility-breakout-signal';
import { ETF_COST_PROFILE, applySlippage, calcCommission, calcTax } from './etf-cost-profile';
import { DatedBar, BacktestTrade, EquityPoint, TrackBacktestResult } from './two-tier-backtest.types';

export interface SatelliteBacktestOptions {
  /** 초기 가상원금(원). 기본 10,000,000. */
  initialCapital?: number;
  /** 진입 파라미터(K·목표변동성·추세필터). 기본 §9.1 frozen. */
  params?: BreakoutEntryParams;
  /** 비용 프로파일. 기본 ETF(거래세 0). */
  costs?: BacktestCostParams;
}

const DEFAULT_INITIAL_CAPITAL = 10_000_000;

/** date 오름차순 정렬(방어적 복제). */
function sortedByDate(bars: readonly DatedBar[]): DatedBar[] {
  return [...bars].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * 위성 변동성 돌파 일단위 백테스트(KODEX200 단일).
 *
 * @param bars KODEX200(069500) 일봉 배열(오름차순 권장, 내부서 재정렬).
 * @param opts 초기원금·진입 파라미터·비용 프로파일.
 * @returns 트랙 결과(트레이드·자산곡선·표본수=평가 거래일 수).
 */
export function backtestSatelliteBreakout(
  bars: readonly DatedBar[],
  opts: SatelliteBacktestOptions = {},
): TrackBacktestResult {
  const initialCapital = opts.initialCapital ?? DEFAULT_INITIAL_CAPITAL;
  const params = opts.params ?? DEFAULT_BREAKOUT_ENTRY_PARAMS;
  const costs = opts.costs ?? ETF_COST_PROFILE;

  const series = sortedByDate(bars);
  let equity = initialCapital;
  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  let sampleCount = 0;

  // 최근 종가(추세필터용, 마지막=전일 종가). 필터 OFF 면 미사용.
  for (let t = 1; t < series.length; t++) {
    const prevBar: OhlcBar = series[t - 1];
    const today = series[t];
    sampleCount++;

    const recentCloses = series.slice(0, t).map((b) => b.close); // ~전일까지
    const decision = evaluateBreakoutEntry(prevBar, today.open, today.high, recentCloses, params);

    if (decision.triggered && decision.targetPrice !== null && t + 1 < series.length) {
      // 체결가 = max(목표가, 당일 시가) — 갭업이면 시가 체결(불리).
      const fillRaw = Math.max(decision.targetPrice, today.open);
      const entryPx = applySlippage(fillRaw, costs.slippagePct, true);
      const shares = computeVolAdjustedSizing(prevBar, params.targetDailyVolPct, equity, fillRaw);

      if (shares !== null && shares > 0) {
        const exitBar = series[t + 1];
        const exitRaw = exitBar.open;
        const exitPx = applySlippage(exitRaw, costs.slippagePct, false);

        const entryValue = shares * entryPx;
        const exitValue = shares * exitPx;
        const buyComm = calcCommission(entryValue, costs.commissionRate);
        const sellComm = calcCommission(exitValue, costs.commissionRate);
        const sellTax = calcTax(exitValue, costs.taxRate);
        const entrySlip = shares * fillRaw * costs.slippagePct;
        const exitSlip = shares * exitRaw * costs.slippagePct;

        const gross = (exitPx - entryPx) * shares;
        const totalCosts = buyComm + sellComm + sellTax + entrySlip + exitSlip;
        const net = gross - totalCosts;
        equity += net;

        trades.push({
          assetCode: SATELLITE_TARGET_ETF_CODE,
          entryDate: today.date,
          entryPrice: entryPx,
          shares,
          exitDate: exitBar.date,
          exitPrice: exitPx,
          costs: totalCosts,
          grossPnl: gross,
          netPnl: net,
          returnPct: (net / entryValue) * 100,
          holdDays: 1,
          reason: 'BREAKOUT_NEXT_OPEN_EXIT',
        });
      }
    }

    equityCurve.push({ date: today.date, equity });
  }

  const finalEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : initialCapital;

  return {
    styleTag: SATELLITE_STYLE_TAG,
    trades,
    equityCurve,
    sampleCount,
    initialCapital,
    finalEquity,
  };
}

/** 위성 대상 코드(서비스 조립 편의). */
export const SATELLITE_UNIVERSE_CODE = SATELLITE_TARGET_ETF_CODE;
