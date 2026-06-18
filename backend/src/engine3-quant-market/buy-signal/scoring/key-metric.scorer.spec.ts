// 회귀 안전망 (DAR-127): 핵심 수치 점수(C2) 이벤트 타입·임계값별 단조 매핑 고정.
// 순수 Rule — DB/AI 미개입. 신호 도메인 취약점(임계값 회귀) 방어.
import {
  scoreKeyMetric,
  hasKeyMetricRule,
  KEY_METRIC_RULE_EVENT_TYPES,
} from './key-metric.scorer';

describe('scoreKeyMetric (DAR-127 회귀 안전망)', () => {
  describe('SUPPLY_CONTRACT — salesRatio 단조 가점', () => {
    it.each([
      [30, 100],
      [25, 80],
      [20, 80],
      [12, 60],
      [10, 60],
      [7, 40],
      [5, 40],
      [3, 20],
      [1, 20],
      [0.5, 0],
      [0, 0],
    ])('salesRatio=%p → %p', (ratio, expected) => {
      expect(
        scoreKeyMetric({ eventType: 'SUPPLY_CONTRACT', extractedData: { salesRatio: ratio } }),
      ).toBe(expected);
    });
  });

  describe('SHARE_CANCELLATION — cancellationRatio 단조 가점(하한 30)', () => {
    it.each([
      [5, 100],
      [4, 80],
      [3, 80],
      [2, 60],
      [1, 60],
      [0.5, 30],
      [0, 30],
    ])('cancellationRatio=%p → %p', (cr, expected) => {
      expect(
        scoreKeyMetric({ eventType: 'SHARE_CANCELLATION', extractedData: { cancellationRatio: cr } }),
      ).toBe(expected);
    });
  });

  describe('DIVIDEND_INCREASE — yoyDividendGrowth 단조 가점', () => {
    it.each([
      [50, 100],
      [20, 70],
      [10, 40],
      [5, 40],
      [1, 10],
      [0, 10],
    ])('yoyDividendGrowth=%p → %p', (dy, expected) => {
      expect(
        scoreKeyMetric({ eventType: 'DIVIDEND_INCREASE', extractedData: { yoyDividendGrowth: dy } }),
      ).toBe(expected);
    });
  });

  describe('PAID_IN_CAPITAL_INCREASE — dilutionRate 단조 감점(전 구간 음수)', () => {
    it.each([
      [30, -100],
      [20, -80],
      [10, -60],
      [5, -40],
      [1, -20],
      [0, -20],
    ])('dilutionRate=%p → %p', (dr, expected) => {
      const score = scoreKeyMetric({
        eventType: 'PAID_IN_CAPITAL_INCREASE',
        extractedData: { dilutionRate: dr },
      });
      expect(score).toBe(expected);
      expect(score).toBeLessThanOrEqual(0);
    });
  });

  describe('CB_ISSUANCE — cbRatio = fundingAmount/marketCap 감점', () => {
    it('cbRatio≥20% → -80', () => {
      expect(
        scoreKeyMetric({
          eventType: 'CB_ISSUANCE',
          extractedData: { fundingAmount: 250, marketCap: 1000 },
        }),
      ).toBe(-80);
    });
    it('10%≤cbRatio<20% → -50', () => {
      expect(
        scoreKeyMetric({
          eventType: 'CB_ISSUANCE',
          extractedData: { fundingAmount: 150, marketCap: 1000 },
        }),
      ).toBe(-50);
    });
    it('cbRatio<10% → -20', () => {
      expect(
        scoreKeyMetric({
          eventType: 'CB_ISSUANCE',
          extractedData: { fundingAmount: 50, marketCap: 1000 },
        }),
      ).toBe(-20);
    });
    it('marketCap 결측(=0 폴백 후 1) → 분모 보호로 cbRatio 0 → -20', () => {
      // num(marketCap, 1)이 0을 그대로 받으면 marketCap>0 가드로 cbRatio=0.
      expect(
        scoreKeyMetric({
          eventType: 'CB_ISSUANCE',
          extractedData: { fundingAmount: 100, marketCap: 0 },
        }),
      ).toBe(-20);
    });
  });

  describe('EARNINGS_SURPRISE — surpriseRate 단조 가점', () => {
    it.each([
      [30, 100],
      [15, 70],
      [5, 40],
      [1, 10],
      [0, 10],
    ])('surpriseRate=%p → %p', (sr, expected) => {
      expect(
        scoreKeyMetric({ eventType: 'EARNINGS_SURPRISE', extractedData: { surpriseRate: sr } }),
      ).toBe(expected);
    });
  });

  describe('결측·미지원 처리', () => {
    it('미지원 eventType → 0(중립)', () => {
      expect(scoreKeyMetric({ eventType: 'UNKNOWN_EVENT', extractedData: {} })).toBe(0);
    });
    it('필수 수치 null → fallback 0으로 처리', () => {
      expect(
        scoreKeyMetric({ eventType: 'SUPPLY_CONTRACT', extractedData: { salesRatio: null } }),
      ).toBe(0);
    });
    it('문자열 수치도 Number 변환', () => {
      expect(
        scoreKeyMetric({
          eventType: 'SUPPLY_CONTRACT',
          extractedData: { salesRatio: '25' as unknown as number },
        }),
      ).toBe(80);
    });
    it('NaN 문자열 → fallback 0', () => {
      expect(
        scoreKeyMetric({
          eventType: 'EARNINGS_SURPRISE',
          extractedData: { surpriseRate: 'abc' as unknown as number },
        }),
      ).toBe(10);
    });
  });

  // ─── DAR-321: hasKeyMetricRule 순수 헬퍼 (가용 판정용) ───
  describe('hasKeyMetricRule (DAR-321 — 규칙 멤버십 ↔ 채점 default 정합)', () => {
    const RULE_TYPES = [
      'SUPPLY_CONTRACT',
      'SHARE_CANCELLATION',
      'DIVIDEND_INCREASE',
      'PAID_IN_CAPITAL_INCREASE',
      'CB_ISSUANCE',
      'EARNINGS_SURPRISE',
    ];
    const UNMODELED_TYPES = [
      'SHARE_BUYBACK',
      'MAJOR_SHAREHOLDER_CHANGE',
      'OTHER',
      'UNKNOWN_EVENT',
      'EARNINGS_SHOCK',
    ];

    it('규칙 집합 멤버는 true', () => {
      for (const t of RULE_TYPES) expect(hasKeyMetricRule(t)).toBe(true);
    });

    it('미모델(규칙 없음) 이벤트는 false', () => {
      for (const t of UNMODELED_TYPES) expect(hasKeyMetricRule(t)).toBe(false);
    });

    it('parity: 규칙 멤버는 비-default 점수를 낼 수 있고, 비멤버는 항상 default 0', () => {
      // 비멤버 이벤트는 어떤 extractedData 라도 scoreKeyMetric default→0.
      for (const t of UNMODELED_TYPES) {
        expect(KEY_METRIC_RULE_EVENT_TYPES.has(t)).toBe(false);
        expect(scoreKeyMetric({ eventType: t, extractedData: { salesRatio: 35, surpriseRate: 30 } })).toBe(0);
      }
      // 규칙 멤버는 멤버십과 집합이 일치.
      for (const t of RULE_TYPES) {
        expect(KEY_METRIC_RULE_EVENT_TYPES.has(t)).toBe(true);
      }
    });
  });
});
