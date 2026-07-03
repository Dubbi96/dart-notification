// DAR-493 — 2단 자본 프레임 상수 + ETF 비용 프로파일 결정론 검증.

import {
  TWO_TIER_CAPITAL_FRAME,
  FRAME_CORE_PCT,
  FRAME_SATELLITE_PCT,
  FRAME_CASH_BUFFER_PCT,
  FRAME_TOTAL_PCT,
} from './capital-frame.constants';
import {
  STOCK_COST_PROFILE,
  ETF_COST_PROFILE,
  costProfileForAssetClass,
  applySlippage,
  calcCommission,
  calcTax,
} from './etf-cost-profile';
import { CORE_CAPITAL_ALLOCATION_PCT } from '../dual-momentum/dual-momentum.constants';
import { SATELLITE_CAPITAL_ALLOCATION_PCT } from '../volatility-breakout/volatility-breakout.constants';
import { DEFAULT_REPLAY_COSTS } from '../backtest/replay/backtest-replay.service';

describe('2단 자본 프레임 상수', () => {
  it('코어 65% / 위성 25% / 버퍼 10% (frozen)', () => {
    expect(FRAME_CORE_PCT).toBe(0.65);
    expect(FRAME_SATELLITE_PCT).toBe(0.25);
    expect(FRAME_CASH_BUFFER_PCT).toBe(0.1);
  });

  it('합 = 1.0 (부동소수 오차 허용)', () => {
    expect(FRAME_TOTAL_PCT).toBeCloseTo(1.0, 10);
  });

  it('코어/위성 비율은 각 트랙 상수를 승계(드리프트 방지)', () => {
    expect(FRAME_CORE_PCT).toBe(CORE_CAPITAL_ALLOCATION_PCT);
    expect(FRAME_SATELLITE_PCT).toBe(SATELLITE_CAPITAL_ALLOCATION_PCT);
    expect(TWO_TIER_CAPITAL_FRAME.corePct).toBe(FRAME_CORE_PCT);
  });
});

describe('ETF 비용 프로파일', () => {
  it('STOCK 프로파일 == 기존 DEFAULT_REPLAY_COSTS (기존 백테스트 결과 무변경 회귀 고정)', () => {
    expect(STOCK_COST_PROFILE).toEqual(DEFAULT_REPLAY_COSTS);
  });

  it('ETF 프로파일 = 거래세 0, 수수료·슬리피지는 개별주와 동일', () => {
    expect(ETF_COST_PROFILE.taxRate).toBe(0);
    expect(ETF_COST_PROFILE.commissionRate).toBe(STOCK_COST_PROFILE.commissionRate);
    expect(ETF_COST_PROFILE.slippagePct).toBe(STOCK_COST_PROFILE.slippagePct);
  });

  it('costProfileForAssetClass: 기본/STOCK → 개별주, ETF → ETF', () => {
    expect(costProfileForAssetClass()).toEqual(STOCK_COST_PROFILE);
    expect(costProfileForAssetClass('STOCK')).toEqual(STOCK_COST_PROFILE);
    expect(costProfileForAssetClass('ETF')).toEqual(ETF_COST_PROFILE);
  });

  it('비용 헬퍼: 슬리피지(매수 위·매도 아래)·수수료·세금', () => {
    expect(applySlippage(1000, 0.003, true)).toBeCloseTo(1003, 6);
    expect(applySlippage(1000, 0.003, false)).toBeCloseTo(997, 6);
    expect(calcCommission(1_000_000, 0.00015)).toBeCloseTo(150, 6);
    expect(calcTax(1_000_000, 0)).toBe(0); // ETF 면제
    expect(calcTax(1_000_000, 0.0018)).toBeCloseTo(1800, 6);
  });
});
