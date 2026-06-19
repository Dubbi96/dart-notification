import { CandleHistoryService } from './candle-history.service';
import { PrismaService } from '../../prisma/prisma.service';

/** newest-first(DESC)로 조회된 가짜 행(서비스가 오름차순으로 뒤집어야 함). */
function rowsDesc(times: string[]) {
  return times.map((t, i) => ({
    time: new Date(t),
    open: 100 + i,
    high: 110 + i,
    low: 90 + i,
    close: 105 + i,
    volume: BigInt(1000 + i),
  }));
}

describe('CandleHistoryService (DAR-378)', () => {
  const NOW = Date.UTC(2026, 5, 20, 5, 0, 0);

  function make(queryImpl: jest.Mock) {
    const prisma = { $queryRaw: queryImpl } as unknown as PrismaService;
    return new CandleHistoryService(prisma);
  }

  it('잘못된 stockCode 는 CandleQueryError 를 던진다(컨트롤러 400 매핑)', async () => {
    const svc = make(jest.fn());
    await expect(svc.getCandles({ stockCode: 'bad' }, NOW)).rejects.toThrow(
      /6자리/,
    );
  });

  it('DESC 조회 결과를 시간 오름차순으로 반환하고 출처/조회시각을 고지', async () => {
    // newest-first: 09:02, 09:01, 09:00
    const query = jest.fn().mockResolvedValue(
      rowsDesc([
        '2026-06-20T09:02:00.000Z',
        '2026-06-20T09:01:00.000Z',
        '2026-06-20T09:00:00.000Z',
      ]),
    );
    const svc = make(query);
    const res = await svc.getCandles({ stockCode: '005930' }, NOW);

    expect(res.source).toBe('TIMESCALE');
    expect(res.asOf).toBe(new Date(NOW).toISOString());
    expect(res.count).toBe(3);
    expect(res.candles.map((c) => c.time)).toEqual([
      '2026-06-20T09:00:00.000Z',
      '2026-06-20T09:01:00.000Z',
      '2026-06-20T09:02:00.000Z',
    ]);
    // BigInt volume 이 number 로 변환
    expect(typeof res.candles[0].volume).toBe('number');
  });

  it('limit 가득 차면 가장 오래된 캔들을 nextCursor 로 제공, 아니면 null', async () => {
    const times = Array.from({ length: 3 }, (_, i) =>
      new Date(Date.UTC(2026, 5, 20, 9, 2 - i, 0)).toISOString(),
    );
    const fullQuery = jest.fn().mockResolvedValue(rowsDesc(times));
    const full = await make(fullQuery).getCandles(
      { stockCode: '005930', limit: 3 },
      NOW,
    );
    // 오름차순 첫 캔들(=가장 오래됨)이 커서
    expect(full.nextCursor).toBe(full.candles[0].time);

    const partialQuery = jest.fn().mockResolvedValue(rowsDesc(times));
    const partial = await make(partialQuery).getCandles(
      { stockCode: '005930', limit: 10 },
      NOW,
    );
    expect(partial.nextCursor).toBeNull();
  });

  it('관계 부재 등 조회 실패는 UNAVAILABLE + 빈 배열로 graceful', async () => {
    const query = jest
      .fn()
      .mockRejectedValue(new Error('relation "stock_minute_prices" does not exist'));
    const svc = make(query);
    const res = await svc.getCandles({ stockCode: '005930' }, NOW);

    expect(res.source).toBe('UNAVAILABLE');
    expect(res.candles).toEqual([]);
    expect(res.count).toBe(0);
    expect(res.nextCursor).toBeNull();
  });

  it('해상도별로 조회가 호출된다(5m/1d 도 graceful 경로 통과)', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const svc = make(query);
    const r5 = await svc.getCandles(
      { stockCode: '005930', resolution: '5m' },
      NOW,
    );
    const r1d = await svc.getCandles(
      { stockCode: '005930', resolution: '1d' },
      NOW,
    );
    expect(r5.resolution).toBe('5m');
    expect(r1d.resolution).toBe('1d');
    expect(query).toHaveBeenCalledTimes(2);
  });
});
