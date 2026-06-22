// Engine5 — 분봉 단타 청산 판정 + 상수 (순수 Rule, DAR-411)
//
// AI 금지영역 불가침: 청산(익절/손절/강제) 판정은 순수 수식·시각 게이트. AI 개입 0.
// 단타 = 오버나잇 금지 → 당일 강제청산(15:20)이 손익과 무관하게 최우선.

/** 영속·표면화 트랙 식별 태그(PaperTrade.styleTag / strategyKey SSOT). */
export const INTRADAY_SCALP_STYLE_TAG = 'intraday-scalp';

/** 익절 임계(%). 현재가가 진입가 대비 +2% 이상이면 익절. */
export const TAKE_PROFIT_PCT = 2.0;
/** 손절 임계(%). 현재가가 진입가 대비 -1.2% 이하이면 손절. */
export const STOP_LOSS_PCT = -1.2;
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
  takeProfitPct: number;
  stopLossPct: number;
  forceExitHhmm: string;
}

export const DEFAULT_SCALP_EXIT_PARAMS: ScalpExitParams = {
  takeProfitPct: TAKE_PROFIT_PCT,
  stopLossPct: STOP_LOSS_PCT,
  forceExitHhmm: FORCE_EXIT_HHMM,
};

export interface ScalpExitDecision {
  shouldExit: boolean;
  reason: ScalpExitReason | null;
  /** 진입가 대비 현재가 수익률(%) — 비용 미반영(판정 기준값). */
  returnPct: number;
  detail: string;
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
  const returnPct = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;

  if (isForceExitTime(nowHhmm, params)) {
    return {
      shouldExit: true,
      reason: 'FORCE_CLOSE_EOD',
      returnPct,
      detail: `15:20 전량 강제청산(당일 청산 보장) — 수익률 ${returnPct.toFixed(2)}%`,
    };
  }
  if (returnPct >= params.takeProfitPct) {
    return {
      shouldExit: true,
      reason: 'TAKE_PROFIT',
      returnPct,
      detail: `익절 +${params.takeProfitPct}% 도달 — ${returnPct.toFixed(2)}%`,
    };
  }
  if (returnPct <= params.stopLossPct) {
    return {
      shouldExit: true,
      reason: 'STOP_LOSS',
      returnPct,
      detail: `손절 ${params.stopLossPct}% 도달 — ${returnPct.toFixed(2)}%`,
    };
  }
  return {
    shouldExit: false,
    reason: null,
    returnPct,
    detail: `보유 유지 — ${returnPct.toFixed(2)}%`,
  };
}
