import { EventStudyCalculationScheduler } from './event-study-calculation.scheduler';
import {
  EventStudyCalculationService,
  EventStudyCalcSummary,
} from './event-study-calculation.service';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';

/**
 * DAR-134 — Event Study baseline cron 의 recorder 래핑·itemCount(readyCount)·
 * throw 흡수 검증. 근본원인: cron 부재로 EventStudyResult 미적재 → historicalEvent
 * 영구 결측 → 신호 전부 WATCH. 본 cron 이 주간 산출로 해소한다.
 */
describe('EventStudyCalculationScheduler (DAR-134)', () => {
  const summary: EventStudyCalcSummary = {
    eventsScanned: 50,
    observationsBuilt: 40,
    observationsPersisted: 40,
    skipped: { noStockOrMarket: 2, noPrices: 3, immatureOrUnaligned: 5 },
    groupsAggregated: 12,
    readyCount: 7,
    insufficientCount: 5,
  };

  function makeCalc(impl?: () => Promise<EventStudyCalcSummary>) {
    return {
      run: jest
        .fn()
        .mockImplementation(impl ?? (() => Promise.resolve(summary))),
    } as unknown as EventStudyCalculationService;
  }

  it('recorder 로 EVENT_STUDY_CALC 잡을 감싸고 readyCount 를 itemCount 로 기록한다', async () => {
    const calc = makeCalc();
    const record = jest
      .fn()
      .mockImplementation(
        async (
          _key: string,
          fn: () => Promise<EventStudyCalcSummary>,
          opts: { countOf: (r: EventStudyCalcSummary) => number },
        ) => {
          const r = await fn();
          expect(opts.countOf(r)).toBe(7); // readyCount
          return r;
        },
      );
    const recorder = { record } as unknown as CronRunRecorderService;

    const scheduler = new EventStudyCalculationScheduler(calc, recorder);
    await scheduler.calculateWeekly();

    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toBe(CRON_JOB_KEYS.EVENT_STUDY_CALC);
    expect(calc.run).toHaveBeenCalledTimes(1);
  });

  it('recorder 미주입 환경에서도 run() 을 직접 실행한다', async () => {
    const calc = makeCalc();
    const scheduler = new EventStudyCalculationScheduler(calc);
    await scheduler.calculateWeekly();
    expect(calc.run).toHaveBeenCalledTimes(1);
  });

  it('run() 이 throw 해도 스케줄러는 예외를 흡수한다(cron 유지)', async () => {
    const calc = makeCalc(() => Promise.reject(new Error('boom')));
    const scheduler = new EventStudyCalculationScheduler(calc);
    await expect(scheduler.calculateWeekly()).resolves.toBeUndefined();
  });
});
