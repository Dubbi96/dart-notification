/**
 * investor-flow.collector.spec.ts — 수급·공매도 EOD 수집기 (갭분석 W16).
 *
 * 검증(실 DB·네트워크 없음): 소스 체인 폴백 분기(1차 0행/오류/비활성 → 폴백), source 컬럼 기록,
 * done-set 멱등 스킵, publishedDate=T+2 저장, BigInt 변환·skipDuplicates, 가용 소스 없음 graceful.
 */

import { InvestorFlowCollector } from './investor-flow.collector';
import { KrxInvestorFlowSource } from './krx-investor-flow.source';
import { KisInvestorFlowSource } from './kis-investor-flow.source';
import {
  InvestorFlowBar,
  InvestorFlowSource,
  ShortSellingBar,
  computeShortBalancePublishedDate,
} from './investor-flow-source';
import { PrismaService } from '../../prisma/prisma.service';

const TARGET = '20260714';

interface PrismaFake {
  prisma: PrismaService;
  investorCreateMany: jest.Mock;
  shortCreateMany: jest.Mock;
}

function makePrisma(opts: { doneInvestor?: string[]; doneShort?: string[] } = {}): PrismaFake {
  const investorCreateMany = jest
    .fn()
    .mockImplementation(({ data }: { data: unknown[] }) => Promise.resolve({ count: data.length }));
  const shortCreateMany = jest
    .fn()
    .mockImplementation(({ data }: { data: unknown[] }) => Promise.resolve({ count: data.length }));
  const prisma = {
    stockDailyPrice: {
      findFirst: jest.fn().mockResolvedValue({ tradeDate: TARGET }),
    },
    company: {
      findMany: jest.fn().mockResolvedValue([{ stockCode: '005930' }, { stockCode: '000660' }]),
    },
    investorFlowDaily: {
      findMany: jest
        .fn()
        .mockResolvedValue((opts.doneInvestor ?? []).map((stockCode) => ({ stockCode }))),
      createMany: investorCreateMany,
    },
    shortSellingDaily: {
      findMany: jest
        .fn()
        .mockResolvedValue((opts.doneShort ?? []).map((stockCode) => ({ stockCode }))),
      createMany: shortCreateMany,
    },
  } as unknown as PrismaService;
  return { prisma, investorCreateMany, shortCreateMany };
}

const flowBar = (over: Partial<InvestorFlowBar> = {}): InvestorFlowBar => ({
  tradeDate: TARGET,
  foreignNetBuyQty: 1_799_843,
  foreignNetBuyAmount: 509_525_000_000,
  institutionNetBuyQty: -413_531,
  institutionNetBuyAmount: -114_994_000_000,
  individualNetBuyQty: -1_363_799,
  individualNetBuyAmount: -388_198_000_000,
  ...over,
});

const shortBar = (over: Partial<ShortSellingBar> = {}): ShortSellingBar => ({
  tradeDate: TARGET,
  shortSellingVolume: 907_025,
  shortSellingAmount: 253_800_807_750,
  shortBalanceQty: null,
  shortBalanceRatio: null,
  ...over,
});

/** 테스트용 가짜 소스 — sourceName·가용성·응답을 주입한다. */
function makeSource(
  sourceName: string,
  available: boolean,
  behavior: {
    flow?: InvestorFlowBar[] | Error;
    short?: ShortSellingBar[] | Error;
  } = {},
): { source: InvestorFlowSource; fetchFlow: jest.Mock; fetchShort: jest.Mock } {
  const resolveOrThrow = <T>(v: T[] | Error | undefined): Promise<T[]> =>
    v instanceof Error ? Promise.reject(v) : Promise.resolve(v ?? []);
  const fetchFlow = jest.fn().mockImplementation(() => resolveOrThrow(behavior.flow));
  const fetchShort = jest.fn().mockImplementation(() => resolveOrThrow(behavior.short));
  return {
    source: {
      sourceName,
      isAvailable: () => available,
      fetchInvestorFlow: fetchFlow,
      fetchShortSelling: fetchShort,
    },
    fetchFlow,
    fetchShort,
  };
}

/** 소스 체인을 주입한 collector 생성(KRX/KIS 실 구현 대신 가짜 소스 — 생성자 배선만 재사용). */
function makeCollector(
  prisma: PrismaService,
  primary: InvestorFlowSource,
  fallback: InvestorFlowSource,
): InvestorFlowCollector {
  return new InvestorFlowCollector(
    prisma,
    primary as unknown as KrxInvestorFlowSource,
    fallback as unknown as KisInvestorFlowSource,
  );
}

const noSleep = () => Promise.resolve();
const baseOpts = { delayMs: 0, sleep: noSleep };

describe('InvestorFlowCollector (W16)', () => {
  it('폴백 분기 — 1차 소스 비활성이면 폴백(KIS) 단독으로 수집하고 source=폴백 기록', async () => {
    const { prisma, investorCreateMany } = makePrisma();
    const { source: krx, fetchFlow: krxFetch } = makeSource('KRX', false);
    const { source: kis } = makeSource('KIS', true, { flow: [flowBar()] });
    const c = makeCollector(prisma, krx, kis);

    const r = await c.collectInvestorFlowOnce(baseOpts);

    expect(krxFetch).not.toHaveBeenCalled(); // 비활성 소스는 체인에서 제외
    expect(r.source).toBe('KIS');
    expect(r.covered).toBe(2);
    expect(r.rowsSaved).toBe(2);
    const firstCall = investorCreateMany.mock.calls[0][0];
    expect(firstCall.skipDuplicates).toBe(true);
    expect(firstCall.data[0]).toMatchObject({ source: 'KIS', tradeDate: TARGET });
  });

  it('폴백 분기 — 1차 소스가 0행이면 다음 소스로 폴백해 행을 채택', async () => {
    const { prisma } = makePrisma();
    const { source: primary, fetchFlow: primaryFetch } = makeSource('KRX', true, { flow: [] });
    const { source: fallback, fetchFlow: fallbackFetch } = makeSource('KIS', true, {
      flow: [flowBar()],
    });
    const c = makeCollector(prisma, primary, fallback);

    const r = await c.collectInvestorFlowOnce({ ...baseOpts, codes: ['005930'] });

    expect(primaryFetch).toHaveBeenCalledTimes(1);
    expect(fallbackFetch).toHaveBeenCalledTimes(1);
    expect(r.source).toBe('KIS');
    expect(r.covered).toBe(1);
  });

  it('폴백 분기 — 1차 소스 오류(throw)도 삼키고 폴백으로 계속(graceful)', async () => {
    const { prisma } = makePrisma();
    const { source: primary } = makeSource('KRX', true, { flow: new Error('상품 부재 404') });
    const { source: fallback } = makeSource('KIS', true, { flow: [flowBar()] });
    const c = makeCollector(prisma, primary, fallback);

    const r = await c.collectInvestorFlowOnce({ ...baseOpts, codes: ['005930'] });

    expect(r.covered).toBe(1);
    expect(r.source).toBe('KIS');
  });

  it('가용 소스 없음(전부 비활성) — 실호출 0·적재 0·message 로 graceful', async () => {
    const { prisma, investorCreateMany } = makePrisma();
    const { source: krx } = makeSource('KRX', false);
    const { source: kis, fetchFlow } = makeSource('KIS', false);
    const c = makeCollector(prisma, krx, kis);

    const r = await c.collectInvestorFlowOnce(baseOpts);

    expect(r.rowsSaved).toBe(0);
    expect(r.source).toBeNull();
    expect(r.message).toContain('가용 소스 없음');
    expect(fetchFlow).not.toHaveBeenCalled();
    expect(investorCreateMany).not.toHaveBeenCalled();
  });

  it('done-set 멱등 — target 일자 기 적재 종목은 재시도 슬롯에서 스킵(잔여만 시도)', async () => {
    const { prisma } = makePrisma({ doneInvestor: ['005930'] });
    const { source: krx } = makeSource('KRX', false);
    const { source: kis, fetchFlow } = makeSource('KIS', true, { flow: [flowBar()] });
    const c = makeCollector(prisma, krx, kis);

    const r = await c.collectInvestorFlowOnce(baseOpts);

    expect(r.attempted).toBe(1); // 유니버스 2종 중 1종만 잔여
    expect(fetchFlow).toHaveBeenCalledTimes(1);
    expect(fetchFlow.mock.calls[0][0]).toBe('000660');
  });

  it('전 종목 기 적재 — no-op(실호출 0)', async () => {
    const { prisma } = makePrisma({ doneInvestor: ['005930', '000660'] });
    const { source: krx } = makeSource('KRX', false);
    const { source: kis, fetchFlow } = makeSource('KIS', true, { flow: [flowBar()] });
    const c = makeCollector(prisma, krx, kis);

    const r = await c.collectInvestorFlowOnce(baseOpts);

    expect(r.attempted).toBe(0);
    expect(r.rowsSaved).toBe(0);
    expect(fetchFlow).not.toHaveBeenCalled();
  });

  it('BigInt 변환 — 순매수 수량·금액(음수 포함)이 BigInt 로 적재된다', async () => {
    const { prisma, investorCreateMany } = makePrisma();
    const { source: krx } = makeSource('KRX', false);
    const { source: kis } = makeSource('KIS', true, { flow: [flowBar()] });
    const c = makeCollector(prisma, krx, kis);

    await c.collectInvestorFlowOnce({ ...baseOpts, codes: ['005930'] });

    const row = investorCreateMany.mock.calls[0][0].data[0];
    expect(row.foreignNetBuyQty).toBe(BigInt(1_799_843));
    expect(row.foreignNetBuyAmount).toBe(BigInt(509_525_000_000));
    expect(row.institutionNetBuyAmount).toBe(BigInt(-114_994_000_000)); // 음수(순매도) 보존
  });

  it('공매도 — publishedDate=T+2 영업일 저장 + 잔고 null(합성 금지) + source 기록', async () => {
    const { prisma, shortCreateMany } = makePrisma();
    const { source: krx } = makeSource('KRX', false);
    const { source: kis } = makeSource('KIS', true, { short: [shortBar()] });
    const c = makeCollector(prisma, krx, kis);

    const r = await c.collectShortSellingOnce({ ...baseOpts, codes: ['005930'] });

    expect(r.rowsSaved).toBe(1);
    const row = shortCreateMany.mock.calls[0][0].data[0];
    expect(row.publishedDate).toBe(computeShortBalancePublishedDate(TARGET));
    expect(row.publishedDate > TARGET).toBe(true); // lookahead 불가침 최소 불변식
    expect(row.shortBalanceQty).toBeNull();
    expect(row.shortBalanceRatio).toBeNull();
    expect(row.shortSellingVolume).toBe(BigInt(907_025));
    expect(row.source).toBe('KIS');
    expect(shortCreateMany.mock.calls[0][0].skipDuplicates).toBe(true);
  });

  it('cap — 잔여 종목이 cap 을 넘으면 상한까지만 시도(레이트리밋 가드)', async () => {
    const { prisma } = makePrisma();
    const { source: krx } = makeSource('KRX', false);
    const { source: kis, fetchFlow } = makeSource('KIS', true, { flow: [flowBar()] });
    const c = makeCollector(prisma, krx, kis);

    const r = await c.collectInvestorFlowOnce({ ...baseOpts, cap: 1 });

    expect(r.attempted).toBe(1);
    expect(fetchFlow).toHaveBeenCalledTimes(1);
  });
});
