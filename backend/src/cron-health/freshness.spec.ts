import {
  buildFreshnessReport,
  evaluateJobFreshness,
  FreshnessJobInput,
  FreshnessJobSpec,
} from './freshness';

// 신선도 판정 순수 함수 — 결정론 검증(now 주입). DB·외부호출 없음.
describe('freshness (DAR-110)', () => {
  // 평일(2026-06-08은 월요일) 장중 10:00 KST 기준 시각.
  const weekdayIntraday = new Date('2026-06-08T10:00:00');
  // 평일 장외 21:00.
  const weekdayEvening = new Date('2026-06-08T21:00:00');
  // 주말(2026-06-07은 일요일) 10:00.
  const weekend = new Date('2026-06-07T10:00:00');

  const alwaysSpec: FreshnessJobSpec = {
    jobKey: 'signal.generate',
    label: '매수 신호 생성',
    source: 'CRON_RUN_LOG',
    window: 'ALWAYS',
    staleAfterMinutes: 60,
    cadence: '평일 19:00',
  };

  const intradaySpec: FreshnessJobSpec = {
    jobKey: 'disclosure.intraday',
    label: '공시 장중 폴링',
    source: 'DISCLOSURE_LOG',
    window: 'WEEKDAY_INTRADAY',
    staleAfterMinutes: 30,
    cadence: '평일 08:00~18:00 / 10분',
  };

  function input(
    spec: FreshnessJobSpec,
    over: Partial<FreshnessJobInput> = {},
  ): FreshnessJobInput {
    return {
      spec,
      lastSuccessAt: null,
      lastStatus: null,
      lastItemCount: null,
      ...over,
    };
  }

  describe('evaluateJobFreshness', () => {
    it('성공 기록이 없으면 stale=true(수집 미가동 의심)', () => {
      const r = evaluateJobFreshness(input(alwaysSpec), weekdayIntraday);
      expect(r.applicable).toBe(true);
      expect(r.isStale).toBe(true);
      expect(r.ageMinutes).toBeNull();
      expect(r.reason).toContain('성공 기록 없음');
    });

    it('허용 경과시간 이내면 stale=false', () => {
      const lastSuccessAt = new Date(weekdayIntraday.getTime() - 10 * 60_000); // 10분 전
      const r = evaluateJobFreshness(
        input(alwaysSpec, { lastSuccessAt, lastStatus: 'SUCCESS', lastItemCount: 3 }),
        weekdayIntraday,
      );
      expect(r.isStale).toBe(false);
      expect(r.ageMinutes).toBe(10);
      expect(r.lastItemCount).toBe(3);
    });

    it('허용 경과시간 초과면 stale=true(정체 의심)', () => {
      const lastSuccessAt = new Date(weekdayIntraday.getTime() - 90 * 60_000); // 90분 전 > 60
      const r = evaluateJobFreshness(
        input(alwaysSpec, { lastSuccessAt, lastStatus: 'SUCCESS' }),
        weekdayIntraday,
      );
      expect(r.isStale).toBe(true);
      expect(r.ageMinutes).toBe(90);
      expect(r.reason).toContain('정체');
    });

    it('경계값(정확히 임계치)은 stale 아님(초과만 stale)', () => {
      const lastSuccessAt = new Date(weekdayIntraday.getTime() - 60 * 60_000); // 정확히 60
      const r = evaluateJobFreshness(
        input(alwaysSpec, { lastSuccessAt, lastStatus: 'SUCCESS' }),
        weekdayIntraday,
      );
      expect(r.isStale).toBe(false);
    });

    it('장중 윈도 밖(평일 저녁)에는 판정 보류(applicable=false)', () => {
      const r = evaluateJobFreshness(
        input(intradaySpec, { lastSuccessAt: null }),
        weekdayEvening,
      );
      expect(r.applicable).toBe(false);
      expect(r.isStale).toBe(false);
      expect(r.reason).toContain('장외시간');
    });

    it('주말에는 장중 잡 판정 보류(applicable=false)', () => {
      const r = evaluateJobFreshness(input(intradaySpec), weekend);
      expect(r.applicable).toBe(false);
      expect(r.isStale).toBe(false);
    });

    it('장중 윈도 안에서 30분 초과 무수집이면 stale', () => {
      const lastSuccessAt = new Date(weekdayIntraday.getTime() - 45 * 60_000);
      const r = evaluateJobFreshness(
        input(intradaySpec, { lastSuccessAt, lastStatus: 'SUCCESS' }),
        weekdayIntraday,
      );
      expect(r.applicable).toBe(true);
      expect(r.isStale).toBe(true);
    });
  });

  // [W11] 제로런 축 — 살아있는데 산출 0행인 정체(2026-07-15 기아 클래스) 판정 에지.
  describe('제로런(zero-run) 판정 (W11)', () => {
    // 장중 스펙 + 제로런 임계 3회(테스트 편의).
    const zeroRunSpec: FreshnessJobSpec = {
      ...intradaySpec,
      zeroRunThreshold: 3,
    };

    /** now 기준 minutesAgo 분 전의 당일 성공 실행. */
    function run(minutesAgo: number, itemCount: number | null, base: Date = weekdayIntraday) {
      return { finishedAt: new Date(base.getTime() - minutesAgo * 60_000), itemCount };
    }

    it('장중 당일 연속 0행이 임계 이상이면 stale(isZeroRun=true) — age 축 신선해도 발화', () => {
      const r = evaluateJobFreshness(
        input(zeroRunSpec, {
          lastSuccessAt: new Date(weekdayIntraday.getTime() - 5 * 60_000), // age 축 신선
          lastStatus: 'SUCCESS',
          lastItemCount: 0,
          recentRuns: [run(5, 0), run(15, 0), run(25, 0)],
        }),
        weekdayIntraday,
      );
      expect(r.applicable).toBe(true);
      expect(r.zeroRunStreak).toBe(3);
      expect(r.isZeroRun).toBe(true);
      expect(r.isStale).toBe(true);
      expect(r.reason).toContain('제로런');
    });

    it('비-0 산출을 만나면 연속 카운트가 리셋되어 미발화', () => {
      const r = evaluateJobFreshness(
        input(zeroRunSpec, {
          lastSuccessAt: new Date(weekdayIntraday.getTime() - 5 * 60_000),
          lastStatus: 'SUCCESS',
          lastItemCount: 0,
          // 최신 2회는 0행이나 그 직전이 7행 — 스트릭 2 < 임계 3.
          recentRuns: [run(5, 0), run(15, 0), run(25, 7), run(35, 0)],
        }),
        weekdayIntraday,
      );
      expect(r.zeroRunStreak).toBe(2);
      expect(r.isZeroRun).toBe(false);
      expect(r.isStale).toBe(false);
    });

    it('건수 미상(null)은 0행으로 치지 않고 카운트를 끊는다', () => {
      const r = evaluateJobFreshness(
        input(zeroRunSpec, {
          lastSuccessAt: new Date(weekdayIntraday.getTime() - 5 * 60_000),
          lastStatus: 'SUCCESS',
          lastItemCount: 0,
          recentRuns: [run(5, 0), run(15, null), run(25, 0)],
        }),
        weekdayIntraday,
      );
      expect(r.zeroRunStreak).toBe(1);
      expect(r.isZeroRun).toBe(false);
    });

    it('전일 0행 기록은 당일 스트릭에 이월되지 않는다(휴장·개장 직후 오탐 방지)', () => {
      const yesterday = new Date(weekdayIntraday.getTime() - 24 * 60 * 60_000);
      const r = evaluateJobFreshness(
        input(zeroRunSpec, {
          lastSuccessAt: new Date(weekdayIntraday.getTime() - 5 * 60_000),
          lastStatus: 'SUCCESS',
          lastItemCount: 0,
          // 당일 1회 + 전일 0행 다수 — 당일 경계에서 단절되어 스트릭 1.
          recentRuns: [run(5, 0), run(10, 0, yesterday), run(20, 0, yesterday)],
        }),
        weekdayIntraday,
      );
      expect(r.zeroRunStreak).toBe(1);
      expect(r.isZeroRun).toBe(false);
    });

    it('장외 시간에는 제로런 축이 미발화한다(WEEKDAY_INTRADAY — 판정 자체 보류)', () => {
      const r = evaluateJobFreshness(
        input(zeroRunSpec, {
          lastSuccessAt: new Date(weekdayEvening.getTime() - 5 * 60_000),
          lastStatus: 'SUCCESS',
          lastItemCount: 0,
          recentRuns: [
            run(5, 0, weekdayEvening),
            run(15, 0, weekdayEvening),
            run(25, 0, weekdayEvening),
          ],
        }),
        weekdayEvening,
      );
      expect(r.applicable).toBe(false);
      expect(r.isZeroRun).toBe(false);
      expect(r.isStale).toBe(false);
    });

    it('ALWAYS 윈도 잡이라도 제로런 축은 장중에만 평가한다(장외 미발화)', () => {
      const alwaysZeroRun: FreshnessJobSpec = { ...alwaysSpec, zeroRunThreshold: 3 };
      const r = evaluateJobFreshness(
        input(alwaysZeroRun, {
          lastSuccessAt: new Date(weekdayEvening.getTime() - 5 * 60_000),
          lastStatus: 'SUCCESS',
          lastItemCount: 0,
          recentRuns: [
            run(5, 0, weekdayEvening),
            run(15, 0, weekdayEvening),
            run(25, 0, weekdayEvening),
          ],
        }),
        weekdayEvening,
      );
      expect(r.applicable).toBe(true); // ALWAYS — age 축은 평가
      expect(r.zeroRunStreak).toBeNull(); // 제로런 축은 장외 보류
      expect(r.isZeroRun).toBe(false);
      expect(r.isStale).toBe(false);
    });

    it('임계 미지정 잡은 제로런 축을 평가하지 않는다(zeroRunStreak=null)', () => {
      const r = evaluateJobFreshness(
        input(intradaySpec, {
          lastSuccessAt: new Date(weekdayIntraday.getTime() - 5 * 60_000),
          lastStatus: 'SUCCESS',
          lastItemCount: 0,
          recentRuns: [run(5, 0), run(15, 0), run(25, 0)],
        }),
        weekdayIntraday,
      );
      expect(r.zeroRunStreak).toBeNull();
      expect(r.isZeroRun).toBe(false);
      expect(r.isStale).toBe(false);
    });

    it('age 정체와 제로런이 동시면 stale 이고 사유는 age 정체를 우선한다', () => {
      const r = evaluateJobFreshness(
        input(zeroRunSpec, {
          lastSuccessAt: new Date(weekdayIntraday.getTime() - 45 * 60_000), // 45분 > 30분
          lastStatus: 'SUCCESS',
          lastItemCount: 0,
          recentRuns: [run(45, 0), run(55, 0), run(65, 0)],
        }),
        weekdayIntraday,
      );
      expect(r.isStale).toBe(true);
      expect(r.reason).toContain('수집 정체');
    });
  });

  // [DAR-515] 휴장일(평일 공휴일·대체공휴일) 오탐 억제 — 시장캘린더(isTradingDay) 참조.
  //   요일 기반 폴링 크론은 평일 공휴일에도 돌며 0행 SUCCESS 를 남기므로, 캘린더 없이는
  //   그 0행 연속이 제로런 오탐이 된다(2026-07-15 기아 대응이 휴장일에 오발화하면 안 됨).
  describe('휴장일 오탐 억제 (DAR-515, 시장캘린더)', () => {
    // 2026-08-17(월) = 광복절 대체공휴일(KRX 휴장). market-calendar 가 지목한 하반기 최초 위험일.
    const holidayIntraday = new Date('2026-08-17T10:00:00');
    // 2026-08-18(화) = 공휴일 다음 정상 거래일(대조군 — 캘린더 게이트가 날짜별임을 증명).
    const tradingDayIntraday = new Date('2026-08-18T10:00:00');

    const zeroRunSpec: FreshnessJobSpec = { ...intradaySpec, zeroRunThreshold: 3 };
    function run(minutesAgo: number, itemCount: number | null, base: Date) {
      return { finishedAt: new Date(base.getTime() - minutesAgo * 60_000), itemCount };
    }

    it('평일 공휴일 장중에는 age 축 정체여도 판정 보류(applicable=false, 사유=휴장일)', () => {
      const lastSuccessAt = new Date(holidayIntraday.getTime() - 90 * 60_000); // 90분 > 30분 임계
      const r = evaluateJobFreshness(
        input(intradaySpec, { lastSuccessAt, lastStatus: 'SUCCESS' }),
        holidayIntraday,
      );
      expect(r.applicable).toBe(false);
      expect(r.isStale).toBe(false);
      expect(r.reason).toContain('휴장일');
    });

    it('평일 공휴일 장중에는 제로런 축이 미발화한다(연속 0행이어도 오탐 0)', () => {
      const r = evaluateJobFreshness(
        input(zeroRunSpec, {
          lastSuccessAt: new Date(holidayIntraday.getTime() - 5 * 60_000), // age 신선
          lastStatus: 'SUCCESS',
          lastItemCount: 0,
          recentRuns: [
            run(5, 0, holidayIntraday),
            run(15, 0, holidayIntraday),
            run(25, 0, holidayIntraday),
          ],
        }),
        holidayIntraday,
      );
      expect(r.applicable).toBe(false);
      expect(r.zeroRunStreak).toBeNull();
      expect(r.isZeroRun).toBe(false);
      expect(r.isStale).toBe(false);
    });

    it('공휴일 다음 거래일에는 정상 평가가 재개되어 제로런이 발화한다(캘린더 게이트는 날짜별)', () => {
      const r = evaluateJobFreshness(
        input(zeroRunSpec, {
          lastSuccessAt: new Date(tradingDayIntraday.getTime() - 5 * 60_000),
          lastStatus: 'SUCCESS',
          lastItemCount: 0,
          recentRuns: [
            run(5, 0, tradingDayIntraday),
            run(15, 0, tradingDayIntraday),
            run(25, 0, tradingDayIntraday),
          ],
        }),
        tradingDayIntraday,
      );
      expect(r.applicable).toBe(true);
      expect(r.zeroRunStreak).toBe(3);
      expect(r.isZeroRun).toBe(true);
      expect(r.isStale).toBe(true);
      expect(r.reason).toContain('제로런');
    });

    it('주말도 휴장 사유로 판정 보류한다(사유 문구를 장외시간과 구분)', () => {
      const r = evaluateJobFreshness(input(intradaySpec), weekend);
      expect(r.applicable).toBe(false);
      expect(r.isStale).toBe(false);
      expect(r.reason).toContain('휴장일');
    });
  });

  describe('buildFreshnessReport', () => {
    it('stale 잡 키 목록과 anyStale 플래그를 집계한다', () => {
      const fresh = new Date(weekdayIntraday.getTime() - 5 * 60_000);
      const report = buildFreshnessReport(
        [
          input(alwaysSpec, { lastSuccessAt: fresh, lastStatus: 'SUCCESS' }),
          input({ ...alwaysSpec, jobKey: 'paper.simulation' }), // 성공기록 없음 → stale
        ],
        weekdayIntraday,
      );
      expect(report.anyStale).toBe(true);
      expect(report.staleJobs).toEqual(['paper.simulation']);
      expect(report.jobs).toHaveLength(2);
      expect(report.generatedAt).toBe(weekdayIntraday.toISOString());
    });

    it('모두 신선하면 anyStale=false', () => {
      const fresh = new Date(weekdayIntraday.getTime() - 5 * 60_000);
      const report = buildFreshnessReport(
        [input(alwaysSpec, { lastSuccessAt: fresh, lastStatus: 'SUCCESS' })],
        weekdayIntraday,
      );
      expect(report.anyStale).toBe(false);
      expect(report.staleJobs).toEqual([]);
    });

    it('동일 입력·동일 now 는 결정론적으로 동일 결과(2회 호출 일치)', () => {
      const fresh = new Date(weekdayIntraday.getTime() - 5 * 60_000);
      const inputs = [input(alwaysSpec, { lastSuccessAt: fresh, lastStatus: 'SUCCESS' })];
      const a = buildFreshnessReport(inputs, weekdayIntraday);
      const b = buildFreshnessReport(inputs, weekdayIntraday);
      expect(a).toEqual(b);
    });
  });
});
