// DualMomentumForwardScheduler 단위 테스트 (DAR-494 [견고화 W1·P13])
// 크론 배선: 서비스 위임 + CronRunRecorder 래핑(잡 키·itemCount) 검증.

import { DualMomentumForwardScheduler } from './dual-momentum-forward.scheduler';
import { CRON_JOB_KEYS } from '../../../cron-health/cron-health.jobs';

describe('DualMomentumForwardScheduler (DAR-494)', () => {
  it('recorder 미주입 시 서비스 사이클을 그대로 호출', async () => {
    const cycle = { tradeDate: 'x', portfolioId: 'pf1', filled: 2, rebalance: 'SWITCH', holding: '360750', pendingTarget: null, equity: 1 };
    const service = { runDailyCycle: jest.fn(() => Promise.resolve(cycle)) } as any;
    const scheduler = new DualMomentumForwardScheduler(service);
    const res = await scheduler.runDaily();

    expect(service.runDailyCycle).toHaveBeenCalledTimes(1);
    expect(res).toBe(cycle);
  });

  it('recorder 주입 시 DUAL_MOMENTUM_FORWARD 잡으로 기록(itemCount=체결 건수)', async () => {
    const cycle = { tradeDate: 'x', portfolioId: 'pf1', filled: 2, rebalance: 'SWITCH', holding: '360750', pendingTarget: null, equity: 1 };
    const service = { runDailyCycle: jest.fn(() => Promise.resolve(cycle)) } as any;
    const recorder = {
      record: jest.fn(async (_key: string, run: any, opts: any) => {
        const r = await run();
        // countOf 가 체결 건수를 반환하는지 확인.
        expect(opts.countOf(r)).toBe(2);
        return r;
      }),
    } as any;
    const scheduler = new DualMomentumForwardScheduler(service, recorder);
    await scheduler.runDaily();

    expect(recorder.record).toHaveBeenCalledTimes(1);
    expect(recorder.record.mock.calls[0][0]).toBe(CRON_JOB_KEYS.DUAL_MOMENTUM_FORWARD);
    expect(CRON_JOB_KEYS.DUAL_MOMENTUM_FORWARD).toBe('paper.dual-momentum-forward');
  });
});
