/**
 * forward-tracks.scheduler.spec.ts — forward 트랙 크론 배선 검증 (live-readiness W1)
 *
 * 결정론적 mock 으로:
 *  - 스타일 크론이 PhilosophyStyleSimulationService.runDailyCycleAllStyles 를 KST YYYYMMDD 로 호출
 *  - 전략 크론이 StrategyForwardSimulationService.runDailyCycleAllStrategies 를 KST YYYYMMDD 로 호출
 *  - CronRunRecorder 에 paper.style-simulation / paper.strategy-forward 키로 기록(itemCount=스냅샷 합)
 *  - recorder 미주입(@Optional) 환경에서도 실행 자체는 동작
 * 을 고정한다. 스케줄러는 트리거만 — 점수·체결 결정 없음(AI 0).
 */
import { ForwardTracksScheduler } from './forward-tracks.scheduler';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';

const STYLE_RESULT = {
  tradeDate: '20260702',
  styles: [
    { style: 'BUFFETT', portfolioId: 'pf1', bought: 1, snapshotted: 2, exited: 0, openPositions: 2, equity: 10_000_000 },
    { style: 'LYNCH', portfolioId: 'pf2', bought: 0, snapshotted: 3, exited: 1, openPositions: 3, equity: 10_000_000 },
  ],
};

const STRATEGY_RESULT = {
  tradeDate: '20260702',
  strategies: [
    { strategyKey: 'event-edge', portfolioId: 'pf3', bought: 0, snapshotted: 1, exited: 0, openPositions: 1, equity: 10_000_000, allowlistEmpty: false },
    { strategyKey: 'short-momentum', portfolioId: 'pf4', bought: 2, snapshotted: 4, exited: 0, openPositions: 4, equity: 10_000_000 },
  ],
};

function buildMocks() {
  const styleSim = { runDailyCycleAllStyles: jest.fn().mockResolvedValue(STYLE_RESULT) };
  const strategySim = {
    runDailyCycleAllStrategies: jest.fn().mockResolvedValue(STRATEGY_RESULT),
  };
  // record(jobKey, run, opts) — 실제 러너처럼 run 을 실행하고 결과를 돌려준다(키·countOf 검증용).
  const recorder = {
    record: jest.fn(
      async (
        _jobKey: string,
        run: () => Promise<unknown>,
        _opts?: { countOf?: (r: never) => number },
      ) => run(),
    ),
  };
  return { styleSim, strategySim, recorder };
}

describe('ForwardTracksScheduler (live-readiness W1)', () => {
  it('스타일 크론: paper.style-simulation 키로 기록하며 KST YYYYMMDD 로 사이클을 발화한다', async () => {
    const { styleSim, strategySim, recorder } = buildMocks();
    const scheduler = new ForwardTracksScheduler(
      styleSim as never,
      strategySim as never,
      recorder as never,
    );

    const result = await scheduler.runStyleDaily();

    expect(recorder.record).toHaveBeenCalledTimes(1);
    const [jobKey, , opts] = recorder.record.mock.calls[0];
    expect(jobKey).toBe(CRON_JOB_KEYS.STYLE_SIMULATION);
    expect(styleSim.runDailyCycleAllStyles).toHaveBeenCalledTimes(1);
    expect(styleSim.runDailyCycleAllStyles.mock.calls[0][0]).toMatch(/^\d{8}$/);
    // itemCount = 스타일 합산 스냅샷(2+3)
    expect(opts?.countOf?.(STYLE_RESULT as never)).toBe(5);
    expect(result).toBe(STYLE_RESULT);
    expect(strategySim.runDailyCycleAllStrategies).not.toHaveBeenCalled();
  });

  it('전략 크론: paper.strategy-forward 키로 기록하며 KST YYYYMMDD 로 사이클을 발화한다', async () => {
    const { styleSim, strategySim, recorder } = buildMocks();
    const scheduler = new ForwardTracksScheduler(
      styleSim as never,
      strategySim as never,
      recorder as never,
    );

    const result = await scheduler.runStrategyDaily();

    expect(recorder.record).toHaveBeenCalledTimes(1);
    const [jobKey, , opts] = recorder.record.mock.calls[0];
    expect(jobKey).toBe(CRON_JOB_KEYS.STRATEGY_FORWARD);
    expect(strategySim.runDailyCycleAllStrategies).toHaveBeenCalledTimes(1);
    expect(strategySim.runDailyCycleAllStrategies.mock.calls[0][0]).toMatch(/^\d{8}$/);
    // itemCount = 전략 합산 스냅샷(1+4)
    expect(opts?.countOf?.(STRATEGY_RESULT as never)).toBe(5);
    expect(result).toBe(STRATEGY_RESULT);
    expect(styleSim.runDailyCycleAllStyles).not.toHaveBeenCalled();
  });

  it('recorder 미주입(@Optional) 환경에서도 두 사이클 모두 직접 실행된다', async () => {
    const { styleSim, strategySim } = buildMocks();
    const scheduler = new ForwardTracksScheduler(styleSim as never, strategySim as never);

    await expect(scheduler.runStyleDaily()).resolves.toBe(STYLE_RESULT);
    await expect(scheduler.runStrategyDaily()).resolves.toBe(STRATEGY_RESULT);
    expect(styleSim.runDailyCycleAllStyles).toHaveBeenCalledTimes(1);
    expect(strategySim.runDailyCycleAllStrategies).toHaveBeenCalledTimes(1);
  });
});
