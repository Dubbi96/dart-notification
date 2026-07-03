/**
 * etf-daily-price.collector.spec.ts — ETF 일봉 증분 수집기 (DAR-484 [견고화 W1·P10]).
 *
 * 검증(실 DB·네트워크 없음): 소스 비활성 graceful no-op, 멱등 적재(createMany skipDuplicates),
 *   OHLC 정합성 손상행 배제, 커버리지 정직 집계, 조회 구간 산정(KST), 단일 실행 락.
 */

import { EtfDailyPriceCollector } from './etf-daily-price.collector';
import { KisEtfDailySource } from './kis-etf-daily.source';
import { EtfDailyBar } from './etf-daily-source';
import { PrismaService } from '../../prisma/prisma.service';

function makePrisma(count = 0) {
  const createMany = jest.fn().mockResolvedValue({ count });
  return {
    prisma: { etfDailyPrice: { createMany } } as unknown as PrismaService,
    createMany,
  };
}

function makeSource(available: boolean, bars: EtfDailyBar[] = []) {
  const fetchDailyBars = jest.fn().mockResolvedValue(bars);
  return {
    source: {
      sourceName: 'KIS',
      isAvailable: () => available,
      fetchDailyBars,
    } as unknown as KisEtfDailySource,
    fetchDailyBars,
  };
}

const bar = (over: Partial<EtfDailyBar> = {}): EtfDailyBar => ({
  tradeDate: '20260703',
  open: 10000,
  high: 10200,
  low: 9900,
  close: 10100,
  volume: 100000,
  tradingValue: 1_000_000_000,
  ...over,
});

const noSleep = () => Promise.resolve();

describe('EtfDailyPriceCollector (DAR-484)', () => {
  it('소스 비활성(키 미설정)이면 no-op — createMany 미호출·rowsSaved 0·message', async () => {
    const { prisma, createMany } = makePrisma();
    const { source } = makeSource(false);
    const c = new EtfDailyPriceCollector(prisma, source);

    const r = await c.collectOnce({ codes: ['069500'], sleep: noSleep });
    expect(r.rowsSaved).toBe(0);
    expect(r.covered).toBe(0);
    expect(r.message).toContain('비활성');
    expect(createMany).not.toHaveBeenCalled();
  });

  it('happy path — 유니버스 각 종목 일봉을 멱등 적재하고 커버리지 집계', async () => {
    const { prisma, createMany } = makePrisma(2);
    const { source, fetchDailyBars } = makeSource(true, [
      bar({ tradeDate: '20260702' }),
      bar({ tradeDate: '20260703' }),
    ]);
    const c = new EtfDailyPriceCollector(prisma, source);

    const r = await c.collectOnce({ codes: ['069500', '360750'], etfDelayMs: 0, sleep: noSleep });

    expect(fetchDailyBars).toHaveBeenCalledTimes(2);
    expect(createMany).toHaveBeenCalledTimes(2);
    // skipDuplicates 멱등 적재.
    expect(createMany.mock.calls[0][0]).toMatchObject({ skipDuplicates: true });
    // source 컬럼 기록 + BigInt 변환.
    const firstRow = createMany.mock.calls[0][0].data[0];
    expect(firstRow).toMatchObject({
      etfCode: '069500',
      tradeDate: '20260702',
      openPrice: 10000,
      closePrice: 10100,
      source: 'KIS',
    });
    expect(firstRow.volume).toBe(BigInt(100000));
    expect(firstRow.tradingValue).toBe(BigInt(1_000_000_000));

    expect(r.covered).toBe(2);
    expect(r.empty).toBe(0);
    expect(r.rowsSaved).toBe(4); // 2종목 × createMany count 2
    expect(r.universeSize).toBe(2);
  });

  it('빈 응답 종목은 empty 로 집계하고 createMany 를 호출하지 않는다', async () => {
    const { prisma, createMany } = makePrisma();
    const { source } = makeSource(true, []);
    const c = new EtfDailyPriceCollector(prisma, source);

    const r = await c.collectOnce({ codes: ['069500'], sleep: noSleep });
    expect(r.covered).toBe(0);
    expect(r.empty).toBe(1);
    expect(createMany).not.toHaveBeenCalled();
  });

  it('OHLC 물리 정합성 손상행은 배제하고 invalidSkipped 로 정직 보고', async () => {
    const { prisma, createMany } = makePrisma(1);
    const { source } = makeSource(true, [
      bar({ tradeDate: '20260701', high: 100, low: 200 }), // 고<저 손상
      bar({ tradeDate: '20260702', open: -1 }), // 음수 손상
      bar({ tradeDate: '2026070', close: 10100 }), // 날짜형식 손상(7자리)
      bar({ tradeDate: '20260703' }), // 정상
    ]);
    const c = new EtfDailyPriceCollector(prisma, source);

    const r = await c.collectOnce({ codes: ['069500'], sleep: noSleep });
    expect(r.invalidSkipped).toBe(3);
    // 정상 1행만 적재 데이터로.
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0][0].data).toHaveLength(1);
    expect(createMany.mock.calls[0][0].data[0].tradeDate).toBe('20260703');
  });

  it('거래대금 0 이하는 null 로 적재', async () => {
    const { prisma, createMany } = makePrisma(1);
    const { source } = makeSource(true, [bar({ tradingValue: 0 })]);
    const c = new EtfDailyPriceCollector(prisma, source);

    await c.collectOnce({ codes: ['069500'], sleep: noSleep });
    expect(createMany.mock.calls[0][0].data[0].tradingValue).toBeNull();
  });

  it('조회 구간은 KST 오늘~lookback 전(달력일)으로 산정된다', async () => {
    const { prisma } = makePrisma();
    const { source, fetchDailyBars } = makeSource(true, [bar()]);
    const c = new EtfDailyPriceCollector(prisma, source);

    const now = new Date('2026-07-03T12:00:00+09:00');
    const r = await c.collectOnce({ codes: ['069500'], lookbackDays: 10, now, sleep: noSleep });

    expect(r.asOf).toBe('20260703');
    expect(r.fromDate).toBe('20260623'); // 10일 전
    expect(fetchDailyBars).toHaveBeenCalledWith('069500', {
      startYmd: '20260623',
      endYmd: '20260703',
      nowMs: now.getTime(),
    });
  });

  it('단일 실행 락 — 진행 중이면 이번 회차 skip', async () => {
    const { prisma } = makePrisma();
    const { source } = makeSource(true, [bar()]);
    const c = new EtfDailyPriceCollector(prisma, source);

    // isCollecting 을 강제로 세팅해 겹침 상황 재현.
    (c as unknown as { isCollecting: boolean }).isCollecting = true;
    const r = await c.collectEtfDailyPricesCron(new Date('2026-07-03T10:10:00+09:00'));
    expect(r).toEqual({ skipped: true });
  });

  it('cron 은 recorder 미주입 시 collectOnce 결과를 그대로 반환', async () => {
    const { prisma } = makePrisma(1);
    const { source } = makeSource(true, [bar()]);
    const c = new EtfDailyPriceCollector(prisma, source);

    const r = await c.collectEtfDailyPricesCron(new Date('2026-07-03T19:10:00+09:00'));
    expect(r).toMatchObject({ covered: expect.any(Number), rowsSaved: expect.any(Number) });
  });
});
