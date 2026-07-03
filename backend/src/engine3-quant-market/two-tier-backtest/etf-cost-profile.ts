// Engine3 — 자산클래스별 백테스트 비용 프로파일 (DAR-493 [견고화 W1·P16])
//
// 기존 백테스트 비용(backtest-replay `DEFAULT_REPLAY_COSTS`: 수수료 0.015%·거래세 0.18%·슬리피지 0.3%)은
// **개별주 전용**이다. ETF 는 증권거래세가 **면제**되므로(2단 프레임 신규 2트랙은 모두 ETF·KODEX200 등),
// 자산클래스별 비용 프로파일을 여기서 정의한다.
//
// ★기존 백테스트 결과 무변경 보장: 이 모듈은 **신규 상수만** 추가한다. 기존 러너/리플레이는
//   여전히 자신의 `DEFAULT_REPLAY_COSTS`(=STOCK 프로파일)를 사용하며 이 파일을 import 하지 않는다.
//   STOCK_COST_PROFILE 이 DEFAULT_REPLAY_COSTS 와 동일함은 스펙이 회귀 고정한다(드리프트 방지).
//   ETF_COST_PROFILE 은 신규 2트랙 백테스트만 소비한다.

import { BacktestCostParams } from '../backtest/ports/backtest.types';

/** 자산클래스 — 비용 프로파일 선택 축. */
export type AssetClass = 'STOCK' | 'ETF';

/**
 * 개별주 비용 프로파일 — 기존 동작(기본값). backtest-replay `DEFAULT_REPLAY_COSTS` 와 동일해야 한다.
 * 수수료 0.015%(매수·매도 각각)·거래세 0.18%(매도)·슬리피지 0.3%(진입·청산 각각).
 */
export const STOCK_COST_PROFILE: BacktestCostParams = {
  commissionRate: 0.00015,
  taxRate: 0.0018,
  slippagePct: 0.003,
};

/**
 * ETF 비용 프로파일 — **증권거래세 면제**(taxRate=0). 수수료·슬리피지는 개별주와 동일하게 유지
 * (ETF 도 위탁수수료·체결 슬리피지는 발생). 신규 2트랙(코어 듀얼모멘텀·위성 변동성돌파) 전용.
 */
export const ETF_COST_PROFILE: BacktestCostParams = {
  commissionRate: 0.00015,
  taxRate: 0, // ETF 증권거래세 면제
  slippagePct: 0.003,
};

/**
 * 자산클래스 → 비용 프로파일. 미지정/STOCK 은 개별주 프로파일(기존 동작 보존).
 * @param assetClass 'STOCK'(기본) | 'ETF'
 */
export function costProfileForAssetClass(assetClass: AssetClass = 'STOCK'): BacktestCostParams {
  return assetClass === 'ETF' ? ETF_COST_PROFILE : STOCK_COST_PROFILE;
}

// ── 순수 비용 계산 헬퍼 (price-constraint.service 의 순수 수식을 도메인 결합 없이 재현) ──
// 이 모듈은 순수 함수 계층이라 NestJS 서비스(PriceConstraintService)를 주입하지 않는다.
// 계산식은 동일: 슬리피지는 매수 시 불리하게 +, 매도 시 불리하게 −.

/** 슬리피지 반영가 — 매수는 위로(불리), 매도는 아래로(불리). */
export function applySlippage(price: number, slippagePct: number, isBuy: boolean): number {
  return isBuy ? price * (1 + slippagePct) : price * (1 - slippagePct);
}

/** 수수료 = 거래대금 × 수수료율(매수·매도 각각). */
export function calcCommission(value: number, commissionRate: number): number {
  return value * commissionRate;
}

/** 거래세 = 거래대금 × 세율(매도 시만 호출). ETF 는 taxRate=0. */
export function calcTax(value: number, taxRate: number): number {
  return value * taxRate;
}
