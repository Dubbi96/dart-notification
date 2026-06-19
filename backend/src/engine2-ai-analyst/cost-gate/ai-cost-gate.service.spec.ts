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

  it('전수분석(2026-06-19): 거래대금 하한 0 — 저거래대금도 L0 스킵 없이 분석된다', () => {
    // 종전 1억 미만 → L0 였으나, 전수분석으로 거래대금 필터 해제(임계 0).
    // 저거래대금이라도 대상 이벤트 + 충분한 신뢰도면 L2(요약·Persona)로 분석.
    expect(gate.evaluateGate({ ...base, tradingValue: 1_000 })).toBe(AiCostLevel.L2);
    expect(gate.evaluateGate({ ...base, tradingValue: 0 })).toBe(AiCostLevel.L2);
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

  // DAR-74: 보유종목 악재 L3는 buyScore 유무와 무관하게 발동해야 한다.
  // (보유 중 종목은 매수 후보 점수가 산출되지 않으므로 buyScore 가 undefined)
  it('보유 종목 악재면 buyScore 없이도 L3 (DAR-74)', () => {
    expect(
      gate.evaluateGate({ ...base, isHolding: true, polarity: 'NEGATIVE' }),
    ).toBe(AiCostLevel.L3);
  });

  it('보유 종목 악재 L3는 buyScore<60 보다 우선한다 (DAR-74)', () => {
    // buyScore 분기였다면 L1로 떨어졌겠지만, 보유 악재 우선 → L3
    expect(
      gate.evaluateGate({ ...base, buyScore: 30, isHolding: true, polarity: 'NEGATIVE' }),
    ).toBe(AiCostLevel.L3);
  });

  // 비용 안전 경계: 보유 + NEGATIVE 동시 충족일 때만 L3.
  it('보유종목이지만 호재(POSITIVE)면 L3 미발동 (비용 안전, DAR-74)', () => {
    expect(
      gate.evaluateGate({ ...base, isHolding: true, polarity: 'POSITIVE' }),
    ).toBe(AiCostLevel.L2);
  });

  it('악재지만 미보유면 L3 미발동 (비용 안전, DAR-74)', () => {
    expect(
      gate.evaluateGate({ ...base, isHolding: false, polarity: 'NEGATIVE' }),
    ).toBe(AiCostLevel.L2);
  });

  it('isHolding 미지정(undefined) + 악재면 L3 미발동 (DAR-74)', () => {
    expect(gate.evaluateGate({ ...base, polarity: 'NEGATIVE' })).toBe(AiCostLevel.L2);
  });

  it('관리종목은 보유 악재여도 L0 차단이 우선한다 (비용 안전, DAR-74)', () => {
    expect(
      gate.evaluateGate({
        ...base,
        isManagementStock: true,
        isHolding: true,
        polarity: 'NEGATIVE',
      }),
    ).toBe(AiCostLevel.L0);
  });

  it('buyScore >= 80 이면 L3 (M6+)', () => {
    expect(gate.evaluateGate({ ...base, buyScore: 85 })).toBe(AiCostLevel.L3);
  });
});
