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
    it('표본 적음(PRELIMINARY n=20)은 램프 감쇠 ≈0.65배 (DAR-324)', () => {
      // DAR-324: [10,30) 단조 램프 0.3→1.0. n=20 → 0.3+0.7*0.5 ≈ 0.65.
      // base=70, trust≈0.65 → round(70*0.65)=45 (부동소수 0.6499… → 45.499… → 45)
      expect(scoreHistoricalEvent({ avgArD5: 5, sampleCount: 20 })).toBe(45);
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

  // ─── DAR-324: PRELIMINARY tier 점진 반영(단조·상한·과신금지) ───
  describe('DAR-324: 소표본 점진 반영 — 단조 상승 + READY 상한', () => {
    /** 동일 통계, 표본만 변화 — PRELIMINARY 구간 감쇠가 n에 단조 증가하는지 본다. */
    const at = (sampleCount: number, isSignificant = false): number =>
      scoreHistoricalEvent({ avgArD5: 5, isSignificant, sampleCount });

    it('(a) n=10 PRELIMINARY 영향은 매우 작다 (강한 감쇠)', () => {
      // n=10 무유의: trust = 0.2(무유의) × 0.3(램프 하한) = 0.06 → base 70 → round(4.2)=4
      expect(at(10)).toBe(4);
      // READY 동일통계(유의·n≥30) 대비 현저히 작다.
      expect(at(10)).toBeLessThan(scoreHistoricalEvent({ avgArD5: 5, isSignificant: true, sampleCount: 100 }));
    });

    it('(b) 표본이 클수록 점수가 단조 증가한다 (스냅 제거)', () => {
      const series = [10, 12, 15, 18, 20, 24, 28, 29].map((n) => at(n, true));
      for (let i = 1; i < series.length; i++) {
        expect(series[i]).toBeGreaterThanOrEqual(series[i - 1]);
      }
      // 최소→최대 사이에 실제 상승이 존재(평탄하지 않음)
      expect(series[series.length - 1]).toBeGreaterThan(series[0]);
    });

    it('(b) PRELIMINARY 는 항상 READY(n≥30 유의) 이하다 (상한·인플레이션 방지)', () => {
      const ready = scoreHistoricalEvent({ avgArD5: 5, isSignificant: true, sampleCount: 30 });
      // 가장 유리한 PRELIMINARY(n=29, 유의)도 READY 미만(n=29 램프 0.965<1)
      expect(at(29, true)).toBeLessThan(ready);
      for (const n of [10, 15, 20, 25, 29]) {
        expect(at(n, true)).toBeLessThanOrEqual(ready);
      }
    });

    it('(d) READY 경로(n≥30) 점수는 불변 — 감쇠 없음 (회귀 0)', () => {
      // 유의·표본충분 → base 그대로 70 (DAR-70 기존 동작)
      expect(scoreHistoricalEvent({ avgArD5: 5, isSignificant: true, sampleCount: 30 })).toBe(70);
      expect(scoreHistoricalEvent({ avgArD5: 5, isSignificant: true, sampleCount: 100 })).toBe(70);
      // 음수 신호도 동일하게 base 보존
      expect(scoreHistoricalEvent({ avgArD5: -5, isSignificant: true, sampleCount: 50 })).toBe(-70);
    });
  });

  // ─── DAR-402: 강건(robust) event edge 우선 ───
  describe('DAR-402 — robustArD5 우선 (이상치 오염 차단)', () => {
    it('robustArD5 미제공 시 avgArD5 로 동작 (회귀 0)', () => {
      const base: HistoricalEventInput = { avgArD5: 5, isSignificant: true, sampleCount: 50 };
      expect(scoreHistoricalEvent(base)).toBe(70);
      // robustArD5: undefined 명시도 동일
      expect(scoreHistoricalEvent({ ...base, robustArD5: undefined })).toBe(70);
    });

    it('robustArD5 제공 시 baseScore 입력으로 avgArD5 대신 robustArD5 사용', () => {
      // 산술평균은 양수(+8 → base 70)지만, 강건 추정치는 음수(-4 → base -70)인 오염 버킷.
      const contaminated: HistoricalEventInput = {
        avgArD5: 8,
        robustArD5: -4,
        isSignificant: true,
        sampleCount: 50,
      };
      // robustArD5(-4)로 채점 → 음의 base. 산술평균(+8)으로 채점했다면 +70 이었을 것.
      expect(scoreHistoricalEvent(contaminated)).toBe(-70);
      expect(scoreHistoricalEvent({ ...contaminated, robustArD5: undefined })).toBe(70);
    });

    it('결측 게이트는 여전히 avgArD5 로 판정 (robustArD5 만으론 통과 못 함)', () => {
      // avgArD5=null → 통계 가용성 없음 → 0점 (robustArD5 가 있어도 데이터 결측 게이트 우선)
      expect(scoreHistoricalEvent({ avgArD5: null, robustArD5: 5 })).toBe(0);
    });

    it('robustArD5=0 도 유효값으로 사용 (null 폴백과 구분)', () => {
      // robustArD5=0 → base 10(0~2 구간). avgArD5=8 이었다면 70. 0 을 폴백 아닌 실값으로 처리.
      const r = scoreHistoricalEvent({ avgArD5: 8, robustArD5: 0, isSignificant: true, sampleCount: 50 });
      expect(r).toBe(10);
    });
  });
});
