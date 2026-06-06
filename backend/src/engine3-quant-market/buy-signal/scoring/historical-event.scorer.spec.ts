import {
  scoreHistoricalEvent,
  HistoricalEventInput,
} from './historical-event.scorer';

/**
 * DAR-70: historical-event 채점 정밀화.
 * - 회귀: avgArD5 만 전달 시 기존 산식과 비트단위 동일.
 * - 정밀화: isSignificant·upProbD5·crashProbD5·sampleCount 반영.
 */
describe('scoreHistoricalEvent (DAR-70)', () => {
  describe('회귀 — avgArD5 단독 (확장 필드 미제공)', () => {
    // 기존 산식 그대로여야 함
    const cases: Array<[number | null, number]> = [
      [null, 0],
      [12, 100],
      [10, 100],
      [7, 70],
      [5, 70],
      [3, 40],
      [2, 40],
      [1, 10],
      [0, 10],
      [-1, -30],
      [-3, -30],
      [-5, -70],
      [-20, -70],
    ];
    it.each(cases)('avgArD5=%p → %p (불변)', (ar5, expected) => {
      expect(scoreHistoricalEvent({ avgArD5: ar5 })).toBe(expected);
    });

    it('avgArD5=null 이면 확장 필드가 있어도 0 (결측 우선)', () => {
      expect(
        scoreHistoricalEvent({
          avgArD5: null,
          isSignificant: true,
          upProbD5: 0.9,
          crashProbD5: 0,
          sampleCount: 100,
        }),
      ).toBe(0);
    });
  });

  describe('유의성 — isSignificant=false 강한 감쇠 (과신 방지)', () => {
    it('유의하지 않으면 양의 신호를 1/5로 감쇠', () => {
      // base=70, trust=0.2 → round(14)=14
      expect(
        scoreHistoricalEvent({ avgArD5: 5, isSignificant: false }),
      ).toBe(14);
    });

    it('유의하면 base 그대로 (감쇠 없음)', () => {
      expect(
        scoreHistoricalEvent({ avgArD5: 5, isSignificant: true }),
      ).toBe(70);
    });

    it('유의하지 않은 음의 신호도 0 쪽으로 감쇠 (노이즈 불신)', () => {
      // base=-70, trust=0.2 → -14
      expect(
        scoreHistoricalEvent({ avgArD5: -5, isSignificant: false }),
      ).toBe(-14);
    });
  });

  describe('upProbD5 가산/감점', () => {
    it('높은 상승확률(>=0.65)은 가산', () => {
      // base=40 + 15 = 55
      expect(scoreHistoricalEvent({ avgArD5: 2, upProbD5: 0.7 })).toBe(55);
    });
    it('낮은 상승확률(<0.40)은 감점', () => {
      // base=40 - 15 = 25
      expect(scoreHistoricalEvent({ avgArD5: 2, upProbD5: 0.3 })).toBe(25);
    });
    it('중립 구간(0.50~0.55)은 가감 없음', () => {
      expect(scoreHistoricalEvent({ avgArD5: 2, upProbD5: 0.52 })).toBe(40);
    });
  });

  describe('crashProbD5 감점', () => {
    it('급락확률 높음(>=0.30)은 강한 감점', () => {
      // base=70 - 30 = 40
      expect(scoreHistoricalEvent({ avgArD5: 5, crashProbD5: 0.35 })).toBe(40);
    });
    it('급락확률 중간(>=0.20)은 감점', () => {
      // base=70 - 15 = 55
      expect(scoreHistoricalEvent({ avgArD5: 5, crashProbD5: 0.25 })).toBe(55);
    });
    it('급락확률 낮음(<0.10)은 감점 없음', () => {
      expect(scoreHistoricalEvent({ avgArD5: 5, crashProbD5: 0.05 })).toBe(70);
    });
  });

  describe('sampleCount 신뢰 감쇠', () => {
    it('표본 매우 적음(<10)은 0.3배', () => {
      // base=70, trust=0.3 → 21
      expect(scoreHistoricalEvent({ avgArD5: 5, sampleCount: 5 })).toBe(21);
    });
    it('표본 적음(<30)은 0.6배', () => {
      // base=70, trust=0.6 → 42
      expect(scoreHistoricalEvent({ avgArD5: 5, sampleCount: 20 })).toBe(42);
    });
    it('표본 충분(>=30)은 감쇠 없음', () => {
      expect(scoreHistoricalEvent({ avgArD5: 5, sampleCount: 100 })).toBe(70);
    });
  });

  describe('종합 — 신호 합성 + clamp', () => {
    it('강한 양의 버킷: 가산 후 100 클램프', () => {
      // base=100 + up15 = 115 → clamp 100
      expect(
        scoreHistoricalEvent({
          avgArD5: 10,
          isSignificant: true,
          upProbD5: 0.7,
          crashProbD5: 0.0,
          sampleCount: 100,
        }),
      ).toBe(100);
    });

    it('무의미+소표본+급락 버킷: 강하게 0으로 수렴', () => {
      // base=70, +crash(-30 @0.35)=40, trust=0.2*0.3=0.06 → round(2.4)=2
      const input: HistoricalEventInput = {
        avgArD5: 5,
        isSignificant: false,
        crashProbD5: 0.35,
        sampleCount: 5,
      };
      expect(scoreHistoricalEvent(input)).toBe(2);
    });

    it('동일 avgArD5라도 버킷 신호로 점수가 갈린다 (정밀화 핵심)', () => {
      const strong = scoreHistoricalEvent({
        avgArD5: 2,
        isSignificant: true,
        upProbD5: 0.7,
        crashProbD5: 0.0,
        sampleCount: 100,
      });
      const weak = scoreHistoricalEvent({
        avgArD5: 2,
        isSignificant: false,
        upProbD5: 0.35,
        crashProbD5: 0.35,
        sampleCount: 8,
      });
      expect(strong).toBeGreaterThan(weak);
    });
  });
});
