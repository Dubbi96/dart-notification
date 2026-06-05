import { AiCostGateService } from './ai-cost-gate.service';
import { AiCostLevel, AiGateInput } from '../types/ai-analyst.types';

describe('AiCostGateService', () => {
  const gate = new AiCostGateService();
  const base: AiGateInput = {
    isManagementStock: false,
    isTargetEventType: true,
    tradingValue: 5_000_000_000,
    confidence: 0.9,
  };

  it('관리종목은 L0', () => {
    expect(gate.evaluateGate({ ...base, isManagementStock: true })).toBe(AiCostLevel.L0);
  });

  it('분석 대상 이벤트가 아니면 L0', () => {
    expect(gate.evaluateGate({ ...base, isTargetEventType: false })).toBe(AiCostLevel.L0);
  });

  it('거래대금 하한 미만이면 L0', () => {
    expect(gate.evaluateGate({ ...base, tradingValue: 1_000 })).toBe(AiCostLevel.L0);
  });

  it('추출 신뢰도 < 0.5 이면 L1', () => {
    expect(gate.evaluateGate({ ...base, confidence: 0.3 })).toBe(AiCostLevel.L1);
  });

  it('대상 이벤트 + 충분한 신뢰도(M3 기본)면 L2', () => {
    expect(gate.evaluateGate(base)).toBe(AiCostLevel.L2);
  });

  it('buyScore < 60 이면 L1 (M6+)', () => {
    expect(gate.evaluateGate({ ...base, buyScore: 50 })).toBe(AiCostLevel.L1);
  });

  it('보유 종목 악재면 L3 (M8+)', () => {
    expect(
      gate.evaluateGate({ ...base, buyScore: 70, isHolding: true, polarity: 'NEGATIVE' }),
    ).toBe(AiCostLevel.L3);
  });

  it('buyScore >= 80 이면 L3 (M6+)', () => {
    expect(gate.evaluateGate({ ...base, buyScore: 85 })).toBe(AiCostLevel.L3);
  });
});
