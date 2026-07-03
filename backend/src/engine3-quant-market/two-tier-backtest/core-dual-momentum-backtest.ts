// Engine3 — 코어 듀얼모멘텀 월말 리밸런싱 백테스트 (순수 함수, DAR-493 [견고화 W1·P16])
//
// P12(dual-momentum-signal) 판정 순수 함수 + P09(market-calendar lastTradingDayOfMonth) 재사용.
// 룩어헤드 방지: 월말 판정은 **판정일까지의 바만**(asOf 절단) 사용, 체결은 **익일 시가**(NEXT_OPEN).
// SWITCH 시 매도→매수 순서(현금 확보 후 진입). ETF 비용 프로파일(거래세 0) 적용.
//
// ★측정 트랙 무접촉: BacktestRun/DB 영속 0. 입력 bars 는 호출자(서비스)가 EtfDailyPrice 로 조립.
// ★AI 개입 0: 전 판정이 P12 순수 수식. 이 백테스트는 게이트(엣지 양수) 계산용 측정 도구.

import { BacktestCostParams } from '../backtest/ports/backtest.types';
import { isLastTradingDayOfMonth } from '../../common/time/market-calendar';
import {
  MOMENTUM_LOOKBACK_DAYS,
  CORE_OFFENSE_INTL_CODE,
  CORE_OFFENSE_DOMESTIC_CODE,
  CORE_ABS_MOMENTUM_FILTER_CODE,
  CORE_DEFENSE_BOND_CODE,
  CORE_STYLE_TAG,
} from '../dual-momentum/dual-momentum.constants';
import { MomentumBar, decideMonthlyRebalance } from '../dual-momentum/dual-momentum-signal';
import { ETF_COST_PROFILE, applySlippage, calcCommission, calcTax } from './etf-cost-profile';
import { DatedBar, BacktestTrade, EquityPoint, TrackBacktestResult } from './two-tier-backtest.types';

export interface CoreBacktestOptions {
  /** 초기 가상원금(원). 기본 10,000,000. */
  initialCapital?: number;
  /** 모멘텀 룩백(거래일). 기본 252(frozen). */
  lookback?: number;
  /** 비용 프로파일. 기본 ETF(거래세 0). */
  costs?: BacktestCostParams;
}

const DEFAULT_INITIAL_CAPITAL = 10_000_000;

/** date 오름차순 정렬(방어적 복제). */
function sortedByDate(bars: readonly DatedBar[]): DatedBar[] {
  return [...bars].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** code → date 정렬 bars 맵. */
function buildSeries(universeBars: Record<string, readonly DatedBar[]>): Map<string, DatedBar[]> {
  const m = new Map<string, DatedBar[]>();
  for (const [code, bars] of Object.entries(universeBars)) m.set(code, sortedByDate(bars || []));
  return m;
}

/** 전 series 날짜 합집합(오름차순 유니크) — 월말 판정용 거래일 캘린더. */
function unionTradingDays(series: Map<string, DatedBar[]>): string[] {
  const set = new Set<string>();
  for (const bars of series.values()) for (const b of bars) set.add(b.date);
  return [...set].sort();
}

/** code 의 date 시점 바(정확 일치). 없으면 null. */
function barOn(series: Map<string, DatedBar[]>, code: string, date: string): DatedBar | null {
  const bars = series.get(code);
  if (!bars) return null;
  // 선형 탐색(구간 짧음). 정확 일치만(체결은 실제 그 날 시가 필요).
  for (let i = bars.length - 1; i >= 0; i--) {
    if (bars[i].date === date) return bars[i];
    if (bars[i].date < date) return null;
  }
  return null;
}

/** code 의 date as-of 종가(date 이하 마지막 바 종가·carry-forward). 없으면 null. */
function closeAsOf(series: Map<string, DatedBar[]>, code: string, date: string): number | null {
  const bars = series.get(code);
  if (!bars) return null;
  let last: number | null = null;
  for (const b of bars) {
    if (b.date <= date) last = b.close;
    else break;
  }
  return last;
}

/** code 의 date 이하 종가 배열(asOf 절단, MomentumBar). */
function momentumBarsAsOf(series: Map<string, DatedBar[]>, code: string, date: string): MomentumBar[] {
  const bars = series.get(code) || [];
  const out: MomentumBar[] = [];
  for (const b of bars) {
    if (b.date <= date) out.push({ close: b.close });
    else break;
  }
  return out;
}

/**
 * 코어 듀얼모멘텀 월말 리밸런싱 백테스트.
 *
 * @param universeBars code(360750/069500/153130/273130) → 일봉 배열(오름차순 권장, 내부서 재정렬).
 * @param opts         초기원금·룩백·비용 프로파일.
 * @returns 트랙 결과(트레이드·자산곡선·표본수=월말 판정 횟수).
 */
export function backtestCoreDualMomentum(
  universeBars: Record<string, readonly DatedBar[]>,
  opts: CoreBacktestOptions = {},
): TrackBacktestResult {
  const initialCapital = opts.initialCapital ?? DEFAULT_INITIAL_CAPITAL;
  const lookback = opts.lookback ?? MOMENTUM_LOOKBACK_DAYS;
  const costs = opts.costs ?? ETF_COST_PROFILE;

  const series = buildSeries(universeBars);
  const dates = unionTradingDays(series);

  let cash = initialCapital;
  let holdingCode: string | null = null;
  let shares = 0;
  let openTrade: BacktestTrade | null = null;
  let pendingTarget: string | null = null;

  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];
  let sampleCount = 0;

  const codesA = CORE_OFFENSE_INTL_CODE;
  const codesB = CORE_OFFENSE_DOMESTIC_CODE;
  const codesT = CORE_ABS_MOMENTUM_FILTER_CODE;

  const holdDaysBetween = (from: string, to: string): number => dates.indexOf(to) - dates.indexOf(from);

  for (const date of dates) {
    // 1) 대기 중 리밸런싱을 이 날(=판정 익일) 시가에 집행 — 매도 후 매수.
    if (pendingTarget !== null) {
      const buyBar = barOn(series, pendingTarget, date);
      const sellBar = holdingCode !== null ? barOn(series, holdingCode, date) : null;
      const canExec = !!buyBar && (holdingCode === null || !!sellBar);
      if (canExec) {
        // 매도(현재 보유 전량)
        if (holdingCode !== null && sellBar && openTrade) {
          const sellPx = applySlippage(sellBar.open, costs.slippagePct, false);
          const exitValue = shares * sellPx;
          const exitComm = calcCommission(exitValue, costs.commissionRate);
          const exitTax = calcTax(exitValue, costs.taxRate);
          const exitSlip = shares * sellBar.open * costs.slippagePct;
          cash += exitValue - exitComm - exitTax;
          const gross = (sellPx - openTrade.entryPrice) * shares;
          const entryComm = openTrade.costs; // 진입 시 적재한 진입 비용
          openTrade.exitDate = date;
          openTrade.exitPrice = sellPx;
          openTrade.reason = 'SWITCH_EXIT';
          openTrade.costs = entryComm + exitComm + exitTax + exitSlip;
          openTrade.grossPnl = gross;
          openTrade.netPnl = gross - openTrade.costs;
          openTrade.returnPct = (openTrade.netPnl / (openTrade.entryPrice * shares)) * 100;
          openTrade.holdDays = holdDaysBetween(openTrade.entryDate, date);
          trades.push(openTrade);
          openTrade = null;
          shares = 0;
        }
        // 매수(목표 전량) — 방어자산도 동일하게 매수 보유.
        const buyPx = applySlippage(buyBar.open, costs.slippagePct, true);
        const perShareCost = buyPx * (1 + costs.commissionRate);
        const buyShares = Math.floor(cash / perShareCost);
        if (buyShares > 0) {
          const buyValue = buyShares * buyPx;
          const buyComm = calcCommission(buyValue, costs.commissionRate);
          const buySlip = buyShares * buyBar.open * costs.slippagePct;
          cash -= buyValue + buyComm;
          shares = buyShares;
          holdingCode = pendingTarget;
          openTrade = {
            assetCode: holdingCode,
            entryDate: date,
            entryPrice: buyPx,
            shares,
            exitDate: null,
            exitPrice: null,
            costs: buyComm + buySlip,
            grossPnl: null,
            netPnl: null,
            returnPct: null,
            holdDays: null,
            reason: 'SWITCH_ENTRY',
          };
        } else {
          holdingCode = null; // 매수 불가(현금 부족) — 보유 없음
          shares = 0;
        }
        pendingTarget = null;
      }
      // canExec=false 면 pendingTarget 유지 → 다음 날 재시도(양쪽 바 존재 시).
    }

    // 2) 월말이면 판정(asOf 절단) → 다음날 집행 예약.
    if (isLastTradingDayOfMonth(date, { actualTradingDays: dates })) {
      sampleCount++;
      const decision = decideMonthlyRebalance(
        momentumBarsAsOf(series, codesA, date),
        momentumBarsAsOf(series, codesB, date),
        momentumBarsAsOf(series, codesT, date),
        holdingCode,
        lookback,
      );
      // suspended(결측)면 target=null → 전월 유지(무행동). target==holding 도 무행동.
      if (decision.target !== null && decision.target !== holdingCode) {
        pendingTarget = decision.target;
      }
    }

    // 3) 종가 기준 마크투마켓.
    const mark = holdingCode !== null ? closeAsOf(series, holdingCode, date) : null;
    const equity = cash + (holdingCode !== null && mark !== null ? shares * mark : 0);
    equityCurve.push({ date, equity });
  }

  const finalEquity = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : initialCapital;

  return {
    styleTag: CORE_STYLE_TAG,
    trades,
    equityCurve,
    sampleCount,
    initialCapital,
    finalEquity,
  };
}

/** 코어 유니버스 코드(서비스 조립 편의). */
export const CORE_UNIVERSE_CODES = [
  CORE_OFFENSE_INTL_CODE,
  CORE_OFFENSE_DOMESTIC_CODE,
  CORE_ABS_MOMENTUM_FILTER_CODE,
  CORE_DEFENSE_BOND_CODE,
] as const;
