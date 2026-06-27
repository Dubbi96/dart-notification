// 체결 시뮬레이터 — 순수 Rule 함수 (M10-A, DAR-16)
// AI 금지영역: 체결 로직은 수식/파라미터 기반. AI 개입 0.

import { FillParams, FillRequest, FillResult } from './paper-trade.types';

export const DEFAULT_FILL_PARAMS: FillParams = {
  commissionRate: 0.00015,       // 0.015% 수수료
  sellTaxRate: 0.0018,           // 0.18% 증권거래세
  slippagePct: 0.0005,           // 0.05% 기본 슬리피지
  partialFillThreshold: 0.1,     // 유동성비율 10% 미만 시 부분체결
  // F8 Phase2: 거래량 기반 동적 슬리피지·부분체결(매수 전용) 파라미터(캘리브레이션 근거는 타입 주석 참조).
  maxParticipation: 0.10,        // 일거래량 10%까지 전량체결, 초과분만 부분체결
  impactCoeff: 0.015,            // 제곱근 시장충격 계수(α): 슬리피지 = base + α·√(참여율)
};

const DEFAULT_MAX_PARTICIPATION = 0.10;
const DEFAULT_IMPACT_COEFF = 0.015;

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
 * F8(2026-06-27): KRX 호가단위(tick size) — 2023-01 개정 7구간 계단(KOSPI 기준).
 * 체결가가 시장에 존재할 수 없는 임의 실수가 되지 않도록 호가단위로 정렬한다.
 * (시장 구분 미반영 근사 — 일부 고가 KOSDAQ에서 과대 반올림 가능, 영향 작음.)
 */
export function krxTickSize(price: number): number {
  if (price < 2000) return 1;
  if (price < 5000) return 5;
  if (price < 20000) return 10;
  if (price < 50000) return 50;
  if (price < 200000) return 100;
  if (price < 500000) return 500;
  return 1000;
}

/**
 * 호가단위 정렬 — '불리한 방향 고정'(BUY 올림/SELL 내림)으로 슬리피지를 항상 비용으로 유지.
 * (최근접 반올림은 슬리피지가 1틱 미만일 때 0으로 소멸해 무마찰로 회귀하므로 채택하지 않음.)
 */
export function roundToTick(price: number, direction: 'BUY' | 'SELL'): number {
  const t = krxTickSize(price);
  return direction === 'BUY'
    ? Math.ceil(price / t) * t
    : Math.floor(price / t) * t;
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
  // F8 Phase2: 참여율(주문량/일거래량) — 매수(진입)이고 dayVolume 제공 시에만 산정.
  //   매도/청산·dayVolume 미제공은 participation=0 → 동적 슬리피지·부분체결 미적용(기존 동작·회귀 0).
  const maxParticipation = params.maxParticipation ?? DEFAULT_MAX_PARTICIPATION;
  const impactCoeff = params.impactCoeff ?? DEFAULT_IMPACT_COEFF;
  const participation =
    req.direction === 'BUY' && req.dayVolume && req.dayVolume > 0
      ? req.orderedShares / req.dayVolume
      : 0;

  // 유동성비율: 명시값(req.liquidityRatio) 우선 — 기존 경로 회귀 0. 없으면 참여율 기반 산정
  //   (참여율 ≤ maxParticipation → 1.0 전량, 초과 → maxParticipation/참여율 로 캡). dayVolume 없으면 1.0.
  const liquidity =
    req.liquidityRatio ??
    (participation > 0 ? Math.min(1, maxParticipation / participation) : 1.0);

  // 부분체결 계산 (기존 partialFillThreshold 게이트 유지)
  let filledShares: number;
  if (liquidity < params.partialFillThreshold) {
    filledShares = Math.floor(req.orderedShares * Math.max(liquidity, 0));
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

  // 슬리피지: 기본 + F8 Phase2 시장충격(제곱근 모델, 참여율 기반). participation=0 이면 base(기존 동작).
  const effSlippagePct =
    params.slippagePct + impactCoeff * Math.sqrt(participation);
  const slippageMultiplier =
    req.direction === 'BUY' ? 1 + effSlippagePct : 1 - effSlippagePct;
  // F8: 슬리피지 반영가를 KRX 호가단위로 정렬(불리한 방향). 시장에 존재할 수 없는 비호가 가격 방지.
  const filledPrice = roundToTick(req.entryPrice * slippageMultiplier, req.direction);

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
