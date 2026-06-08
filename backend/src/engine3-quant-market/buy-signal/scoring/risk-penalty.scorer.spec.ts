// 회귀 안전망 (DAR-127): 리스크 패널티 — 하드 차단(Infinity)·누적 패널티 고정.
// 순수 Rule. 하드 차단 조건이 하나라도 풀리면 위험 신호가 통과되므로 회귀 방어 핵심.
import { scoreRiskPenalty, RiskPenaltyInput } from './risk-penalty.scorer';

const base: RiskPenaltyInput = {
  eventType: 'SUPPLY_CONTRACT',
  isAmendment: false,
  preDsclReturn: null,
  isTradingSuspended: false,
  isManagement: false,
  isInvestmentCaution: false,
  isAbnormalSurge: false,
  dilutionRate: null,
  avgDailyVolume: null,
};

describe('scoreRiskPenalty (DAR-127 회귀 안전망)', () => {
  describe('하드 차단 → Infinity (신호 BLOCKED)', () => {
    it.each([
      ['거래정지', { isTradingSuspended: true }],
      ['관리종목', { isManagement: true }],
      ['투자주의', { isInvestmentCaution: true }],
      ['이상급등', { isAbnormalSurge: true }],
      ['감사의견 위험', { eventType: 'AUDIT_OPINION_RISK' }],
      ['거래정지 이벤트', { eventType: 'TRADING_SUSPENSION' }],
      ['상폐위험', { eventType: 'DELISTING_RISK' }],
    ])('%s → Infinity', (_label, override) => {
      expect(scoreRiskPenalty({ ...base, ...override })).toBe(Infinity);
    });
  });

  describe('누적 패널티 (clamp 0~100)', () => {
    it('정상 — 패널티 0', () => {
      expect(scoreRiskPenalty(base)).toBe(0);
    });
    it('선행급등 >20% → 40+20 누적 = 60', () => {
      expect(scoreRiskPenalty({ ...base, preDsclReturn: 25 })).toBe(60);
    });
    it('선행급등 >10% (≤20) → 20', () => {
      expect(scoreRiskPenalty({ ...base, preDsclReturn: 15 })).toBe(20);
    });
    it('선행급등 정확히 10% → 가점 없음(>10 미충족)', () => {
      expect(scoreRiskPenalty({ ...base, preDsclReturn: 10 })).toBe(0);
    });
    it('preDsclReturn null → 0 폴백', () => {
      expect(scoreRiskPenalty({ ...base, preDsclReturn: null })).toBe(0);
    });
    it('정정공시 → +15', () => {
      expect(scoreRiskPenalty({ ...base, isAmendment: true })).toBe(15);
    });
    it('계약 해제 → +50', () => {
      expect(scoreRiskPenalty({ ...base, eventType: 'CONTRACT_CANCELLATION' })).toBe(50);
    });
    it('유상증자 고희석(>15%) → +30', () => {
      expect(
        scoreRiskPenalty({ ...base, eventType: 'PAID_IN_CAPITAL_INCREASE', dilutionRate: 20 }),
      ).toBe(30);
    });
    it('유상증자 저희석(≤15%) → 가점 없음', () => {
      expect(
        scoreRiskPenalty({ ...base, eventType: 'PAID_IN_CAPITAL_INCREASE', dilutionRate: 15 }),
      ).toBe(0);
    });
    it('유상증자 dilutionRate null → 가점 없음', () => {
      expect(
        scoreRiskPenalty({ ...base, eventType: 'PAID_IN_CAPITAL_INCREASE', dilutionRate: null }),
      ).toBe(0);
    });
    it('저유동성(<10만주) → +20', () => {
      expect(scoreRiskPenalty({ ...base, avgDailyVolume: 99_999 })).toBe(20);
    });
    it('충분 유동성(=10만주) → 가점 없음', () => {
      expect(scoreRiskPenalty({ ...base, avgDailyVolume: 100_000 })).toBe(0);
    });
    it('avgDailyVolume null → 가점 없음', () => {
      expect(scoreRiskPenalty({ ...base, avgDailyVolume: null })).toBe(0);
    });
    it('다중 누적은 100으로 clamp', () => {
      const score = scoreRiskPenalty({
        ...base,
        preDsclReturn: 30, // +60
        isAmendment: true, // +15
        eventType: 'CONTRACT_CANCELLATION', // +50
        avgDailyVolume: 1000, // +20
      });
      expect(score).toBe(100);
    });
  });
});
