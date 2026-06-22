// 체결 시뮬레이터 — 순수 Rule 함수 (M10-A, DAR-16)
// AI 금지영역: 체결 로직은 수식/파라미터 기반. AI 개입 0.

import { FillParams, FillRequest, FillResult } from './paper-trade.types';

export const DEFAULT_FILL_PARAMS: FillParams = {
  commissionRate: 0.00015,       // 0.015% 수수료
  sellTaxRate: 0.0018,           // 0.18% 증권거래세
  slippagePct: 0.0005,           // 0.05% 슬리피지
  partialFillThreshold: 0.1,     // 유동성비율 10% 미만 시 부분체결
};

/**
 * 왕복(매수→매도) 거래비용율 — 체결금액 대비 분율(0~1). 비용율 SSOT(DAR-418).
 *
 * 단타는 매수·매도마다 비용이 발생하므로, gross 가격수익률과 net 순수익률의 간극이
 * 작은 익절폭을 적자로 뒤집을 수 있다. 그 간극이 정확히 이 왕복비용율이다.
 *   매수: 수수료(commissionRate) + 슬리피지(slippagePct)
 *   매도: 수수료(commissionRate) + 매도세(sellTaxRate) + 슬리피지(slippagePct)
 * → 합 = 2·commissionRate + sellTaxRate + 2·slippagePct
 *
 * ★하드코딩 금지: 항상 FillParams(체결 파라미터)에서 산출한다(TP/SL net 환산·진입 fee 허들 SSOT).
 */
export function roundTripCostRate(params: FillParams): number {
  const buy = params.commissionRate + params.slippagePct;
  const sell = params.commissionRate + params.sellTaxRate + params.slippagePct;
  return buy + sell;
}

/** 왕복 거래비용율을 백분율(%)로 — TP/SL net 환산·표시(gross↔net 간극)·진입 fee 허들에서 사용. */
export function roundTripCostPct(params: FillParams): number {
  return roundTripCostRate(params) * 100;
}

/**
 * 체결 시뮬레이션 (순수 함수 — AI 개입 없음)
 *
 * 슬리피지 모델: 매수는 기준가 × (1 + slippagePct), 매도는 기준가 × (1 - slippagePct)
 * 부분체결: liquidityRatio < partialFillThreshold 이면 orderedShares × liquidityRatio 만큼만 체결
 * 수수료: 체결금액 × commissionRate (매수·매도 공통)
 * 세금: 매도 시만 체결금액 × sellTaxRate
 */
export function simulateFill(req: FillRequest, params: FillParams): FillResult {
  const liquidity = req.liquidityRatio ?? 1.0;

  // 부분체결 계산
  let filledShares: number;
  if (liquidity < params.partialFillThreshold) {
    filledShares = Math.floor(req.orderedShares * liquidity);
  } else {
    filledShares = req.orderedShares;
  }

  if (filledShares <= 0) {
    return {
      filledShares: 0,
      fillRate: 0,
      filledPrice: req.entryPrice,
      commission: 0,
      tax: 0,
      slippageCost: 0,
      status: 'REJECTED',
    };
  }

  // 슬리피지 반영 체결가
  const slippageMultiplier =
    req.direction === 'BUY'
      ? 1 + params.slippagePct
      : 1 - params.slippagePct;
  const filledPrice = req.entryPrice * slippageMultiplier;

  const tradeValue = filledPrice * filledShares;
  const slippageCost = Math.abs(req.entryPrice - filledPrice) * filledShares;
  const commission = tradeValue * params.commissionRate;
  const tax = req.direction === 'SELL' ? tradeValue * params.sellTaxRate : 0;
  const fillRate = filledShares / req.orderedShares;

  const status: FillResult['status'] =
    fillRate >= 1 ? 'FILLED' : 'PARTIAL';

  return {
    filledShares,
    fillRate,
    filledPrice,
    commission,
    tax,
    slippageCost,
    status,
  };
}
