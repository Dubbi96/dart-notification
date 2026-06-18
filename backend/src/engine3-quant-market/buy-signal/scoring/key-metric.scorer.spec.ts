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

  // ─── DAR-322: 신규 3종 catalyst 임계·경계·방향 ───

  describe('SHARE_BUYBACK — buybackRatioToSales 단조 가점(호재)', () => {
    it.each([
      [10, 100],
      [12, 100],
      [5, 80],
      [7, 80],
      [2, 60],
      [3, 60],
      [1, 40],
      [1.5, 40],
      [0.2, 20],
      [0.5, 20],
      [0.1, 0], // 경계 미만 → 0(BUY 격상 안 됨)
      [0, 0],
    ])('buybackRatioToSales=%p → %p', (ratio, expected) => {
      const score = scoreKeyMetric({
        eventType: 'SHARE_BUYBACK',
        extractedData: { buybackRatioToSales: ratio },
      });
      expect(score).toBe(expected);
      expect(score).toBeGreaterThanOrEqual(0); // 호재 → 음수 없음
    });

    it('규모 필드 결측 → 0(미미한 자사주는 BUY로 격상되지 않음)', () => {
      expect(scoreKeyMetric({ eventType: 'SHARE_BUYBACK', extractedData: {} })).toBe(0);
    });
  });

  describe('THIRD_PARTY_ALLOTMENT — dilutionRate 단조 감점(희석·악재, 조건부 하한 0)', () => {
    it.each([
      [30, -100],
      [40, -100],
      [20, -80],
      [25, -80],
      [10, -60],
      [15, -60],
      [5, -40],
      [7, -40],
      [1, -20],
      [3, -20],
      [0.5, 0], // 희석 미미/전략적 3자배정 → 조건부 0(자동 감점 안 함)
      [0, 0],
    ])('dilutionRate=%p → %p', (dr, expected) => {
      const score = scoreKeyMetric({
        eventType: 'THIRD_PARTY_ALLOTMENT',
        extractedData: { dilutionRate: dr },
      });
      expect(score).toBe(expected);
      expect(score).toBeLessThanOrEqual(0); // 희석성 → 양수 없음
    });

    it('희석률 결측 → 0(조건부)', () => {
      expect(scoreKeyMetric({ eventType: 'THIRD_PARTY_ALLOTMENT', extractedData: {} })).toBe(0);
    });
  });

  describe('MAJOR_SHAREHOLDER_CHANGE — ownershipRatio 보수적 양(+), 상한 +50·하한 0', () => {
    // 주의: keyMetric extractedData 에는 ratioChange(delta)가 없다 — 추출기가 산출하는 정량 필드는
    //       ownershipRatio(변경 후 지분율)뿐이라 이를 사용(신규 추출/배선 금지 제약).
    it.each([
      [50, 50],
      [80, 50], // MIXED 방향 불확실 → STRONG 영역 미진입(상한 +50)
      [30, 35],
      [45, 35],
      [15, 20],
      [29, 20],
      [14.9, 0], // 경계 미만 → 0(BUY 격상 안 됨)
      [0, 0],
    ])('ownershipRatio=%p → %p', (ratio, expected) => {
      const score = scoreKeyMetric({
        eventType: 'MAJOR_SHAREHOLDER_CHANGE',
        extractedData: { ownershipRatio: ratio },
      });
      expect(score).toBe(expected);
      expect(score).toBeGreaterThanOrEqual(0); // 음수 없음
      expect(score).toBeLessThanOrEqual(50); // 보수적 상한
    });

    it('ratioChange 는 keyMetric 입력에 없음 → ownershipRatio 결측이면 0(조용한 false 양성 방지)', () => {
      // ratioChange 만 주어져도 무시되고 0(해당 필드는 insider scorer 전용).
      expect(
        scoreKeyMetric({ eventType: 'MAJOR_SHAREHOLDER_CHANGE', extractedData: { ratioChange: 9 } }),
      ).toBe(0);
      expect(scoreKeyMetric({ eventType: 'MAJOR_SHAREHOLDER_CHANGE', extractedData: {} })).toBe(0);
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
      // DAR-322: omit→실평가 승격된 3종.
      'SHARE_BUYBACK',
      'THIRD_PARTY_ALLOTMENT',
      'MAJOR_SHAREHOLDER_CHANGE',
    ];
    // DAR-322 이후에도 여전히 규칙 없는(default→0) 타입만 남긴다.
    const UNMODELED_TYPES = [
      'OTHER',
      'UNKNOWN_EVENT',
      'EARNINGS_SHOCK',
      'BW_ISSUANCE',
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
