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
