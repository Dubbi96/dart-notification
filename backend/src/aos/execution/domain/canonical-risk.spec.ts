import { RiskPolicyLimits } from '../../risk-policy/domain/risk-policy-version.types';
import { CanonicalRiskInput, evaluateCanonicalRisk } from './canonical-risk';

const limits: RiskPolicyLimits = {
  schemaVersion: 1,
  singleBuyMaxPct: 0.05,
  singlePositionMaxPct: 0.1,
  dailyLossMaxPct: -0.02,
  weeklyLossMaxPct: -0.05,
  monthlyLossMaxPct: -0.1,
  maxDrawdownPct: -0.15,
  maxOpenOrders: 5,
  maxDailyTrades: 10,
  maxOpenPositions: 10,
  maxSectorPct: 0.3,
  minCashReservePct: 0.1,
  killSwitchMode: 'REDUCE_ONLY',
  constraints: {
    assetClass: 'KR_STOCK',
    direction: 'LONG_ONLY',
    allowShort: false,
    allowLeverage: false,
    autoCoverFromLongTermAssets: false,
  },
};

const base: CanonicalRiskInput = {
  side: 'BUY',
  accountType: 'SYSTEM_TRADING',
  accountStatus: 'ACTIVE',
  signalBlocked: false,
  killSwitchActive: false,
  killSwitchMode: 'REDUCE_ONLY',
  requestedQuantity: 100,
  referencePrice: 10_000,
  totalCapital: 100_000_000,
  availableCash: 50_000_000,
  currentPositionValue: 0,
  sectorExposureValue: 0,
  dailyPnl: 0,
  weeklyPnl: 0,
  monthlyPnl: 0,
  drawdownPct: 0,
  openOrders: 0,
  dailyTrades: 0,
  openPositions: 0,
};

describe('evaluateCanonicalRisk', () => {
  it('Kill Switch가 다른 모든 판정보다 먼저 신규 매수를 차단한다', () => {
    expect(evaluateCanonicalRisk({ ...base, killSwitchActive: true }, limits)).toEqual({
      action: 'BLOCK',
      approvedQuantity: 0,
      violations: ['KILL_SWITCH_ACTIVE'],
    });
  });

  it('장기계좌를 시스템 주문에 쓰지 못하게 차단한다', () => {
    expect(
      evaluateCanonicalRisk({ ...base, accountType: 'LONG_TERM' }, limits).violations,
    ).toContain('ACCOUNT_NOT_SYSTEM_TRADING');
  });

  it('허용 수량을 초과하면 거부 대신 승인 범위로 축소한다', () => {
    expect(evaluateCanonicalRisk({ ...base, requestedQuantity: 1_000 }, limits)).toEqual({
      action: 'REDUCE',
      approvedQuantity: 500,
      violations: ['QUANTITY_REDUCED_TO_RISK_CAPACITY'],
    });
  });

  it('REDUCE_ONLY에서는 청산 주문을 허용하지만 FULL_HALT는 차단한다', () => {
    expect(
      evaluateCanonicalRisk(
        { ...base, side: 'SELL', killSwitchActive: true, killSwitchMode: 'REDUCE_ONLY' },
        limits,
      ).action,
    ).toBe('ALLOW');
    expect(
      evaluateCanonicalRisk(
        { ...base, side: 'SELL', killSwitchActive: true, killSwitchMode: 'FULL_HALT' },
        limits,
      ).action,
    ).toBe('BLOCK');
  });
});
