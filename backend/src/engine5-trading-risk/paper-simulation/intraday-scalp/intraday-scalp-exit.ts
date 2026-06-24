// Engine5 — 분봉 단타 청산 판정 + 상수 (순수 Rule, DAR-411 / DAR-418)
//
// AI 금지영역 불가침: 청산(익절/손절/강제) 판정은 순수 수식·시각 게이트. AI 개입 0.
// 단타 = 오버나잇 금지 → 당일 강제청산(15:20)이 손익과 무관하게 최우선.
//
// ★DAR-418 fee-aware: 단타는 매도마다 비용이 부과되므로 TP/SL 임계를 **순(net) 기준**으로 둔다.
//   gross 가격수익률에서 왕복비용율(roundTripCostPct)을 차감한 net 수익률로 익절/손절을 판정해,
//   "+2% gross 익절이 실제로는 순 +1.7%"라 소액 익절이 수수료에 먹혀 적자전환하는 문제를 막는다.
//   비용율 SSOT = engine5 체결 파라미터(FillParams) → roundTripCostPct(). 하드코딩 금지.

import { DEFAULT_FILL_PARAMS, roundTripCostPct } from '../../domain/fill-simulator';
import { minuteTimestamp } from '../../../engine3-quant-market/market-data/minute-timestamp';

/** 영속·표면화 트랙 식별 태그(PaperTrade.styleTag / strategyKey SSOT). */
export const INTRADAY_SCALP_STYLE_TAG = 'intraday-scalp';

/** 순(net) 익절 목표(%). 비용 차감 후 이 순익률을 달성하도록 gross 임계를 비용만큼 상향 환산. */
export const TAKE_PROFIT_PCT = 2.0;
/** 순(net) 손절 목표(%, 음수). gross 임계를 비용만큼 좁혀(상향) 과손실을 방지. */
export const STOP_LOSS_PCT = -1.2;
/**
 * 기본 왕복 거래비용율(%) — 체결 파라미터(DEFAULT_FILL_PARAMS)에서 산출한 SSOT 값.
 *   2·0.015% + 0.18% + 2·0.05% = 0.31%. ★상수 리터럴이 아니라 체결율에서 파생(하드코딩 금지).
 */
export const DEFAULT_ROUND_TRIP_COST_PCT = roundTripCostPct(DEFAULT_FILL_PARAMS);
/** 신규 진입 마감 시각(KST HHMM, 포함). 이후 진입 금지(당일 청산 보장). */
export const ENTRY_CUTOFF_HHMM = '1520';
/** 전량 강제청산 시각(KST HHMM, 포함). 단타 오버나잇 금지. */
export const FORCE_EXIT_HHMM = '1520';
/** 동시 보유 상한(종목당 1포지션 전제). */
export const MAX_OPEN_POSITIONS = 5;
/** 종목당 예산 비율(가상원금 대비). engine5 1회 매수 하드룰(3%)과 정합. */
export const PER_POSITION_BUDGET_PCT = 0.03;
/** 가상 원금(KRW) — 일봉 모의운용(PaperSimulationService.INITIAL_CAPITAL)과 동일 스케일. */
export const SCALP_INITIAL_CAPITAL = 10_000_000;

export type ScalpExitReason = 'TAKE_PROFIT' | 'STOP_LOSS' | 'FORCE_CLOSE_EOD';

export interface ScalpExitParams {
  /** 순(net) 익절 목표(%) — net 수익률이 이 값 이상이면 익절. */
  takeProfitPct: number;
  /** 순(net) 손절 목표(%, 음수) — net 수익률이 이 값 이하이면 손절. */
  stopLossPct: number;
  /** 왕복 거래비용율(%) — gross↔net 환산. 체결 파라미터(FillParams)에서 산출(SSOT). */
  roundTripCostPct: number;
  forceExitHhmm: string;
}

export const DEFAULT_SCALP_EXIT_PARAMS: ScalpExitParams = {
  takeProfitPct: TAKE_PROFIT_PCT,
  stopLossPct: STOP_LOSS_PCT,
  roundTripCostPct: DEFAULT_ROUND_TRIP_COST_PCT,
  forceExitHhmm: FORCE_EXIT_HHMM,
};

/** 진입 fee 허들 최소 순마진(%) — 기대이동(gross TP폭)이 왕복비용+이 마진을 넘어야 진입(과차단 방지 위해 작게). */
export const ENTRY_FEE_HURDLE_MIN_MARGIN_PCT = 0.3;

export interface ScalpExitDecision {
  shouldExit: boolean;
  reason: ScalpExitReason | null;
  /** 진입가 대비 현재가 gross 수익률(%) — 비용 미반영(가격 기준). */
  grossReturnPct: number;
  /** 순(net) 수익률(%) — gross − 왕복비용율. ★익절/손절 판정 기준값. */
  netReturnPct: number;
  /** 적용된 왕복 거래비용율(%). */
  roundTripCostPct: number;
  detail: string;
}

/**
 * 순(net) 익절 목표를 달성하기 위한 gross 익절 임계(%) — 순목표 + 왕복비용.
 *   예: 순 +2% 목표·비용 0.31% → gross +2.31%에서 익절(그때 net 이 정확히 +2%).
 */
export function grossTakeProfitThresholdPct(params: ScalpExitParams = DEFAULT_SCALP_EXIT_PARAMS): number {
  return params.takeProfitPct + params.roundTripCostPct;
}

/**
 * 순(net) 손절 목표를 달성하기 위한 gross 손절 임계(%) — 순목표 + 왕복비용(임계를 비용만큼 좁힘).
 *   예: 순 -1.2% 목표·비용 0.31% → gross -0.89%에서 손절(그때 net 이 정확히 -1.2%, 과손실 방지).
 */
export function grossStopLossThresholdPct(params: ScalpExitParams = DEFAULT_SCALP_EXIT_PARAMS): number {
  return params.stopLossPct + params.roundTripCostPct;
}

/**
 * 진입 fee 허들 게이트(DAR-418, 선택·권장) — 순수 함수.
 *
 * 기대이동(gross TP폭)이 왕복비용 + 최소마진을 넘지 못하면 진입 보류 — 수수료만 내는
 * 무의미 거래를 차단한다. 마진은 작게 둬 정상 거래를 과도하게 막지 않는다.
 *   gross TP폭 = 순익절목표 + 왕복비용.  허들: gross TP폭 ≥ 왕복비용 + 최소마진.
 * 비용 SSOT = roundTripCostPct(체결 파라미터에서 산출).
 *
 * @param grossTakeProfitPct 기대이동(gross 익절폭, %) — grossTakeProfitThresholdPct() 산출값.
 * @param costPct            왕복 거래비용율(%).
 * @param minMarginPct       최소 순마진(%) — 기본 ENTRY_FEE_HURDLE_MIN_MARGIN_PCT.
 */
export function passesEntryFeeHurdle(
  grossTakeProfitPct: number,
  costPct: number,
  minMarginPct: number = ENTRY_FEE_HURDLE_MIN_MARGIN_PCT,
): boolean {
  return grossTakeProfitPct >= costPct + minMarginPct;
}

/** HHMM(zero-padded) 문자열 비교로 시각 도달 여부 판정(사전식=시간순). */
function hhmmAtOrAfter(nowHhmm: string, targetHhmm: string): boolean {
  return nowHhmm >= targetHhmm;
}

/** 강제청산 시각 도달 여부(15:20 이후). */
export function isForceExitTime(nowHhmm: string, params: ScalpExitParams = DEFAULT_SCALP_EXIT_PARAMS): boolean {
  return hhmmAtOrAfter(nowHhmm, params.forceExitHhmm);
}

/** 신규 진입 마감 시각 도달 여부(이후 진입 금지). */
export function isPastEntryCutoff(nowHhmm: string): boolean {
  return hhmmAtOrAfter(nowHhmm, ENTRY_CUTOFF_HHMM);
}

/** KRX 정규장 시작 KST 벽시계 HHMM(청산 ts 하한 경계). */
export const KRX_REGULAR_OPEN_HHMM = '0900';
/** KRX 정규장 종료 KST 벽시계 HHMM(청산 ts 상한 경계). */
export const KRX_REGULAR_CLOSE_HHMM = '1530';

/** 청산 ts 불변식 가드레일(DAR-444) 결과. */
export interface ScalpExitTimebaseSeal {
  /** 봉인된 청산 ts — 항상 entryTs 이후·장중(KST 09:00~15:30) naive instant. */
  exitTs: Date;
  /** 보유 시간(분, ≥0) = exitTs − entryTs. */
  holdMinutes: number;
  /** 불변식 위반으로 보정(clamp)됐는지. true 면 호출부가 ERROR 로그. */
  clamped: boolean;
  /** 위반 사유(로그용). 위반 없으면 null. */
  violation: string | null;
}

/**
 * 분봉 단타 청산 ts 불변식 가드레일(DAR-444) — 순수 함수(시계·DB 비의존).
 *
 * 영속 직전 exitTs 가 **(1) entryTs 이후**이고 **(2) 장중(KST 09:00~15:30)**인지 봉인한다.
 * DAR-435 가 청산 timebase(naive-KST)를 통일했으나, timebase 회귀(예: exitTs=`new Date()`
 * 진짜 UTC instant, 또는 minuteTimestamp 파싱 실패 폴백)가 또 생기면 장외(00~06시)·역전
 * 시각이 DB 에 들어갈 수 있다. 이 가드가 영속 직전 마지막 방어선이다.
 *
 * 규약: entryTs·candidateExitTs 는 'KST 벽시계를 UTC 컴포넌트에 담은 naive instant'(minuteTimestamp
 *   규약). 따라서 getTime() 비교가 곧 KST 벽시계 비교다. 실-UTC instant(now 폴백)는 같은 벽시계의
 *   naive 보다 9h 뒤(작은 getTime)라, 항상 하한(entryTs) 미달 → 보정으로 흡수된다.
 *
 * 보정: 장중 경계 [max(entryTs, 09:00), 15:30] 로 clamp. entryTs 는 진입 충족봉(장중)이므로 하한으로
 *   안전. minuteTimestamp 파싱 실패 시 graceful(해당 경계 미적용).
 */
export function sealScalpExitTimebase(
  entryTs: Date,
  candidateExitTs: Date,
  tradeDate: string,
): ScalpExitTimebaseSeal {
  const openTs = minuteTimestamp(tradeDate, KRX_REGULAR_OPEN_HHMM);
  const closeTs = minuteTimestamp(tradeDate, KRX_REGULAR_CLOSE_HHMM);
  // 하한 = max(entryTs, 장시작). entryTs 가 장중이면 보통 entryTs(== 또는 > 09:00).
  const lower = openTs && openTs.getTime() > entryTs.getTime() ? openTs : entryTs;
  const upper = closeTs ?? candidateExitTs; // 파싱 실패 graceful — 상한 미적용.

  const violations: string[] = [];
  let sealed = candidateExitTs;
  if (sealed.getTime() < lower.getTime()) {
    violations.push(
      `exitTs(${sealed.toISOString()}) < 하한 ${lower.toISOString()}(역전/장외-전)`,
    );
    sealed = lower;
  }
  if (sealed.getTime() > upper.getTime()) {
    violations.push(
      `exitTs(${sealed.toISOString()}) > 장마감 ${upper.toISOString()}(장외-후)`,
    );
    sealed = upper;
  }
  const holdMinutes = Math.max(
    0,
    Math.floor((sealed.getTime() - entryTs.getTime()) / 60_000),
  );
  return {
    exitTs: sealed,
    holdMinutes,
    clamped: violations.length > 0,
    violation: violations.length > 0 ? violations.join('; ') : null,
  };
}

/**
 * 분봉 단타 청산 판정(순수 함수).
 *
 * 우선순위: 강제청산(15:20) > 익절(+2%) > 손절(-1.2%).
 * 강제청산은 손익과 무관하게 최우선 — 당일 청산을 무조건 보장(오버나잇 금지).
 *
 * @param entryPrice 진입 체결가
 * @param currentPrice 현재가(분봉 종가 또는 실시간 시세)
 * @param nowHhmm 현재 KST 벽시계 'HHMM'
 */
export function evaluateScalpExit(
  entryPrice: number,
  currentPrice: number,
  nowHhmm: string,
  params: ScalpExitParams = DEFAULT_SCALP_EXIT_PARAMS,
): ScalpExitDecision {
  const grossReturnPct = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;
  // ★fee-aware: net = gross − 왕복비용율. 익절/손절은 이 net 기준으로 판정한다(DAR-418).
  const netReturnPct = grossReturnPct - params.roundTripCostPct;
  const base = { grossReturnPct, netReturnPct, roundTripCostPct: params.roundTripCostPct };
  const fmt = `gross ${grossReturnPct.toFixed(2)}% / net ${netReturnPct.toFixed(2)}%`;

  if (isForceExitTime(nowHhmm, params)) {
    return {
      ...base,
      shouldExit: true,
      reason: 'FORCE_CLOSE_EOD',
      detail: `15:20 전량 강제청산(당일 청산 보장) — ${fmt}`,
    };
  }
  if (netReturnPct >= params.takeProfitPct) {
    return {
      ...base,
      shouldExit: true,
      reason: 'TAKE_PROFIT',
      detail: `익절 순 +${params.takeProfitPct}% 도달(gross ${grossTakeProfitThresholdPct(params).toFixed(2)}%) — ${fmt}`,
    };
  }
  if (netReturnPct <= params.stopLossPct) {
    return {
      ...base,
      shouldExit: true,
      reason: 'STOP_LOSS',
      detail: `손절 순 ${params.stopLossPct}% 도달(gross ${grossStopLossThresholdPct(params).toFixed(2)}%) — ${fmt}`,
    };
  }
  return {
    ...base,
    shouldExit: false,
    reason: null,
    detail: `보유 유지 — ${fmt}`,
  };
}
