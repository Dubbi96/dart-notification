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
