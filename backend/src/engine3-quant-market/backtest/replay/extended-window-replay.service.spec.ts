import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { BacktestSignalAssemblyService } from './backtest-signal-assembly.service';
import { BacktestReplayService } from './backtest-replay.service';
import { ExtendedWindowReplayService } from './extended-window-replay.service';

/**
 * 청크 오케스트레이션·완주 집계 검증(DB 무의존) — assemble/executeReplay 를 목킹한다.
 * 러너 자체의 정확성·캐시 결과불변은 backtest-runner.spec / caching-price-data.adapter.spec 소관.
 */
describe('ExtendedWindowReplayService (DAR-544 — 11년 러너 청크 완주)', () => {
  function makeService(opts?: {
    signalsPerChunk?: number;
    tradesPerChunk?: number;
    failOn?: string; // 이 startDate 청크에서 throw
  }) {
    const signalsPerChunk = opts?.signalsPerChunk ?? 2;
    const tradesPerChunk = opts?.tradesPerChunk ?? 1;
    const assemble = jest
      .fn()
      .mockImplementation(async () => Array.from({ length: signalsPerChunk }, (_, i) => ({ rcpNo: `R${i}` })));
    const executeReplay = jest.fn().mockImplementation(async (_s, _a, _st, _c, startDate: string) => {
      if (opts?.failOn && startDate === opts.failOn) throw new Error('boom');
      return {
        trades: Array.from({ length: tradesPerChunk }, () => ({})),
        metrics: { totalReturn: 5, winRate: 50 },
        equityCurve: [],
      };
    });
    const prisma = {} as PrismaService;
    const assembly = { assemble } as unknown as BacktestSignalAssemblyService;
    const replay = { executeReplay } as unknown as BacktestReplayService;
    return { service: new ExtendedWindowReplayService(prisma, assembly, replay), assemble, executeReplay };
  }

  it('연 단위 청크로 창을 분할하고 청크별 날짜 구간을 정확히 준다', async () => {
    const { service, executeReplay } = makeService();
    const report = await service.run({ startYear: 2015, endYear: 2017, chunkYears: 1 });

    expect(report.mode).toBe('CHUNKED');
    expect(report.chunks.map((c) => [c.startDate, c.endDate])).toEqual([
      ['2015-01-01', '2015-12-31'],
      ['2016-01-01', '2016-12-31'],
      ['2017-01-01', '2017-12-31'],
    ]);
    // executeReplay 가 청크마다 1회(총 3회) 호출.
    expect(executeReplay).toHaveBeenCalledTimes(3);
    expect(report.completed).toBe(true);
  });

  it('청크가 창 길이 이상이면 단일 패스(MONOLITHIC)', async () => {
    const { service } = makeService();
    const report = await service.run({ startYear: 2015, endYear: 2026, chunkYears: 99 });
    expect(report.mode).toBe('MONOLITHIC');
    expect(report.chunks).toHaveLength(1);
    expect(report.chunks[0]).toMatchObject({ startDate: '2015-01-01', endDate: '2026-12-31' });
  });

  it('asOf 는 진행 중 마지막 연도의 종료일을 절단한다', async () => {
    const { service } = makeService();
    const report = await service.run({
      startYear: 2017,
      endYear: 2017,
      chunkYears: 1,
      asOf: '2017-06-30',
    });
    expect(report.window.endDate).toBe('2017-06-30');
    expect(report.chunks[0].endDate).toBe('2017-06-30');
  });

  it('완주 집계 — 신호·거래·청크 수를 합산한다', async () => {
    const { service } = makeService({ signalsPerChunk: 4, tradesPerChunk: 2 });
    const report = await service.run({ startYear: 2015, endYear: 2016, chunkYears: 1 });
    expect(report.totals).toMatchObject({ signals: 8, trades: 4, chunks: 2 });
    for (const c of report.chunks) {
      expect(c).toMatchObject({ signals: 4, trades: 2, totalReturnPct: 5, winRatePct: 50 });
      expect(typeof c.elapsedMs).toBe('number');
    }
  });

  it('청크 실패 시 completed=false 로 중단하고 앞선 청크 로그는 보존한다', async () => {
    const { service } = makeService({ failOn: '2016-01-01' });
    const report = await service.run({ startYear: 2015, endYear: 2017, chunkYears: 1 });
    expect(report.completed).toBe(false);
    expect(report.chunks.map((c) => c.startDate)).toEqual(['2015-01-01']); // 2015 완주 후 2016 실패로 중단
  });

  it('유효하지 않은 연도 창은 BadRequest', async () => {
    const { service } = makeService();
    await expect(service.run({ startYear: 2026, endYear: 2015 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('전략 파라미터를 만들지 않는다 — 기본은 DEFAULT_REPLAY_STRATEGY(측정 인프라)', async () => {
    const { service, executeReplay } = makeService();
    await service.run({ startYear: 2015, endYear: 2015 });
    const strategyArg = executeReplay.mock.calls[0][2];
    expect(strategyArg).toMatchObject({ minBuyScore: 50, maxPositions: 50, initialCapital: 10_000_000 });
  });
});
