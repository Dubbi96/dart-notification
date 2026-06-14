/**
 * kis-realtime.poller.spec.ts — KIS 실시간 폴러 (DAR-140, DB/네트워크 미사용)
 *
 * 검증: 키 미설정 graceful no-op(실호출 0), 설정 시 유니버스 폴링→캐시 적재, 에러 흡수.
 */

import { KisRealtimePoller } from './kis-realtime.poller';
import { KisApiService } from './kis-api.service';
import { RealtimeQuoteCache } from './realtime-quote.cache';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { PrismaService } from '../../prisma/prisma.service';

function makePrisma(open: Array<{ corpCode: string; stockCode: string }>, signals: Array<{ corpCode: string; stockCode: string }>) {
  return {
    position: { findMany: jest.fn().mockResolvedValue(open) },
    tradingSignal: { findMany: jest.fn().mockResolvedValue(signals) },
  } as never;
}

describe('KisRealtimePoller (DAR-140)', () => {
  it('KIS 키 미설정이면 no-op(폴링/캐시 0·어댑터 미호출)', async () => {
    const kis = { isConfigured: false, fetchCurrentPrice: jest.fn() } as unknown as KisApiService;
    const cache = new RealtimeQuoteCache();
    const prisma = makePrisma([{ corpCode: 'c1', stockCode: 's1' }], []);
    const poller = new KisRealtimePoller(prisma, kis, cache);

    const res = await poller.pollRealtime();
    expect(res).toEqual({ polled: 0, cached: 0 });
    expect(kis.fetchCurrentPrice).not.toHaveBeenCalled();
    expect(cache.size()).toBe(0);
  });

  it('설정 시 보유+후보 유니버스를 폴링해 캐시에 corpCode 키로 적재', async () => {
    const kis = {
      isConfigured: true,
      fetchCurrentPrice: jest.fn(async (stockCode: string) => ({
        stockCode, price: stockCode === '005930' ? 70000 : 23500, open: 1, high: 1, low: 1, volume: 100,
      })),
    } as unknown as KisApiService;
    const cache = new RealtimeQuoteCache();
    const prisma = makePrisma(
      [{ corpCode: '00126380', stockCode: '005930' }],
      [{ corpCode: '00164779', stockCode: '000660' }],
    );
    const poller = new KisRealtimePoller(prisma, kis, cache);

    const res = await poller.pollRealtime();
    expect(res.polled).toBe(2);
    expect(res.cached).toBe(2);
    expect(cache.getFresh('00126380')?.price).toBe(70000);
    expect(cache.getFresh('00164779')?.price).toBe(23500);
  });

  it('price<=0 행은 캐시 미적재', async () => {
    const kis = {
      isConfigured: true,
      fetchCurrentPrice: jest.fn(async () => ({ stockCode: 's', price: 0, open: 0, high: 0, low: 0, volume: 0 })),
    } as unknown as KisApiService;
    const cache = new RealtimeQuoteCache();
    const prisma = makePrisma([{ corpCode: 'c1', stockCode: 's1' }], []);
    const poller = new KisRealtimePoller(prisma, kis, cache);

    const res = await poller.pollRealtime();
    expect(res.cached).toBe(0);
    expect(cache.size()).toBe(0);
  });

  it('어댑터 throw 는 흡수(cron 유지)', async () => {
    const kis = {
      isConfigured: true,
      fetchCurrentPrice: jest.fn().mockRejectedValue(new Error('boom')),
    } as unknown as KisApiService;
    const cache = new RealtimeQuoteCache();
    const prisma = makePrisma([{ corpCode: 'c1', stockCode: 's1' }], []);
    const poller = new KisRealtimePoller(prisma, kis, cache);

    await expect(poller.pollRealtime()).resolves.toEqual({ polled: 0, cached: 0 });
  });

  // ── DAR-231: 분 경계 초과 시 in-flight 락으로 겹침 차단 ──────────────
  it('이전 폴링 진행 중이면 다음 cron 은 즉시 skip(KIS 미호출·겹침 차단)', async () => {
    // fetchCurrentPrice 를 게이트로 보류시켜 1회차를 "진행 중"으로 고정.
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const kis = {
      isConfigured: true,
      fetchCurrentPrice: jest.fn(async (stockCode: string) => {
        await firstGate; // 첫 호출은 게이트 해제까지 보류 → 폴링 진행 중 유지
        return { stockCode, price: 70000, open: 1, high: 1, low: 1, volume: 100 };
      }),
    } as unknown as KisApiService;
    const cache = new RealtimeQuoteCache();
    const prisma = makePrisma([{ corpCode: '00126380', stockCode: '005930' }], []);
    const poller = new KisRealtimePoller(prisma, kis, cache);

    const first = poller.pollRealtime(); // 보류 — 진행 중 상태로 고정
    await Promise.resolve(); // 첫 호출이 resolveUniverse/fetch await 에 진입하도록 양보
    await Promise.resolve();

    // 같은 분 경계에서 두 번째 cron 발화 — 락에 의해 즉시 skip 되어야 한다.
    const overlapped = await poller.pollRealtime();
    expect(overlapped).toEqual({ polled: 0, cached: 0, skipped: true });
    expect(kis.fetchCurrentPrice as jest.Mock).toHaveBeenCalledTimes(1); // 겹친 호출은 KIS 미호출

    // 1회차 해제 후 정상 완료 + 락 해제 → 이후 폴링 재개 가능.
    releaseFirst();
    await expect(first).resolves.toEqual({ polled: 1, cached: 1 });

    const next = await poller.pollRealtime();
    expect(next).toEqual({ polled: 1, cached: 1 });
    expect(kis.fetchCurrentPrice as jest.Mock).toHaveBeenCalledTimes(2); // 락 해제 후 정상 재호출
  });

  it('폴링 중 throw 로 종료해도 락이 해제되어 다음 분 폴링이 재개된다', async () => {
    const kis = {
      isConfigured: true,
      fetchCurrentPrice: jest
        .fn()
        .mockRejectedValueOnce(new Error('boom')) // 1회차: 에러 흡수 경로
        .mockResolvedValueOnce({ stockCode: 's1', price: 100, open: 1, high: 1, low: 1, volume: 1 }),
    } as unknown as KisApiService;
    const cache = new RealtimeQuoteCache();
    const prisma = makePrisma([{ corpCode: 'c1', stockCode: 's1' }], []);
    const poller = new KisRealtimePoller(prisma, kis, cache);

    await expect(poller.pollRealtime()).resolves.toEqual({ polled: 0, cached: 0 }); // 에러 흡수
    // finally 가 락을 해제했으므로 skip 되지 않고 정상 폴링.
    const after = await poller.pollRealtime();
    expect(after).toEqual({ polled: 1, cached: 1 });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// DAR-232: 폴링 실패 관측성 — CronRunRecorder 래핑
// ─────────────────────────────────────────────────────────────────────────
describe('KisRealtimePoller — CronRunRecorder 관측성 (DAR-232)', () => {
  // CronRunLog create/update 캡처용 recorder 전용 prisma 목.
  function makeRecorderPrisma() {
    return {
      cronRunLog: {
        create: jest.fn().mockResolvedValue({ id: 'run-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
    } as unknown as PrismaService;
  }

  it('키 미설정 no-op 은 기록하지 않는다(분단위 로그 폭주 방지)', async () => {
    const kis = { isConfigured: false, fetchCurrentPrice: jest.fn() } as unknown as KisApiService;
    const recorderPrisma = makeRecorderPrisma();
    const recorder = new CronRunRecorderService(recorderPrisma);
    const poller = new KisRealtimePoller(
      makePrisma([], []),
      kis,
      new RealtimeQuoteCache(),
      recorder,
    );

    const res = await poller.pollRealtime();

    expect(res).toEqual({ polled: 0, cached: 0 });
    expect((recorderPrisma.cronRunLog as any).create).not.toHaveBeenCalled();
  });

  it('성공 시 CronRunLog 에 SUCCESS·적재건수(cached)를 기록한다', async () => {
    const kis = {
      isConfigured: true,
      fetchCurrentPrice: jest.fn(async (stockCode: string) => ({
        stockCode, price: 70000, open: 1, high: 1, low: 1, volume: 100,
      })),
    } as unknown as KisApiService;
    const recorderPrisma = makeRecorderPrisma();
    const recorder = new CronRunRecorderService(recorderPrisma);
    const poller = new KisRealtimePoller(
      makePrisma([{ corpCode: '00126380', stockCode: '005930' }], []),
      kis,
      new RealtimeQuoteCache(),
      recorder,
    );

    const res = await poller.pollRealtime();

    expect(res).toEqual({ polled: 1, cached: 1 });
    expect((recorderPrisma.cronRunLog as any).create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ jobKey: 'kis.realtime-poll', status: 'RUNNING' }),
      }),
    );
    expect((recorderPrisma.cronRunLog as any).update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'SUCCESS', itemCount: 1 }),
      }),
    );
  });

  it('폴링 실패 시 CronRunLog 에 FAILED 를 남기고 cron 은 흡수한다', async () => {
    const kis = {
      isConfigured: true,
      fetchCurrentPrice: jest.fn().mockRejectedValue(new Error('boom')),
    } as unknown as KisApiService;
    const recorderPrisma = makeRecorderPrisma();
    const recorder = new CronRunRecorderService(recorderPrisma);
    const poller = new KisRealtimePoller(
      makePrisma([{ corpCode: 'c1', stockCode: 's1' }], []),
      kis,
      new RealtimeQuoteCache(),
      recorder,
    );

    // 스케줄 유지: 흡수 후 {0,0}.
    await expect(poller.pollRealtime()).resolves.toEqual({ polled: 0, cached: 0 });

    // 실패가 조용히 삼켜지지 않고 FAILED·errorMessage 로 표면화됨.
    expect((recorderPrisma.cronRunLog as any).update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'FAILED', errorMessage: 'boom' }),
      }),
    );
  });
});
