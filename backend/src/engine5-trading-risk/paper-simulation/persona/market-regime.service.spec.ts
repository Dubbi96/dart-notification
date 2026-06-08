/**
 * market-regime.service.spec.ts — 레짐 서비스 DB 결합·graceful 검증 (DAR-130)
 *
 * prisma 모킹으로 (a) 데이터 결측 시 graceful(dataLimited=true) (b) 적재 시 결정론적 분류를 검증한다.
 */

import { MarketRegimeService } from './market-regime.service';
import { PrismaService } from '../../../prisma/prisma.service';

function mockPrisma(opts: {
  indexCloses?: number[]; // 오름차순
  latestDate?: string | null;
  polarityGroups?: Array<{ polarity: string; count: number }>;
  throwIndex?: boolean;
  throwEvents?: boolean;
}): PrismaService {
  const ascending = opts.indexCloses ?? [];
  // 서비스는 desc 로 조회 후 reverse 하므로, desc 행을 돌려준다.
  const descRows = [...ascending].reverse().map((c) => ({ closeIndex: c }));
  return {
    marketIndex: {
      findMany: jest.fn().mockImplementation(async () => {
        if (opts.throwIndex) throw new Error('db down');
        return descRows;
      }),
      findFirst: jest.fn().mockResolvedValue(
        opts.latestDate === undefined ? null : { tradeDate: opts.latestDate },
      ),
    },
    disclosureEvent: {
      groupBy: jest.fn().mockImplementation(async () => {
        if (opts.throwEvents) throw new Error('db down');
        return (opts.polarityGroups ?? []).map((g) => ({
          polarity: g.polarity,
          _count: g.count,
        }));
      }),
    },
  } as unknown as PrismaService;
}

describe('MarketRegimeService (DAR-130)', () => {
  it('데이터 결측 → graceful: 빈 표본·dataLimited=true·기본 레짐', async () => {
    const svc = new MarketRegimeService(mockPrisma({}));
    const r = await svc.getCurrentRegime();
    expect(r.indexSampleSize).toBe(0);
    expect(r.eventSampleSize).toBe(0);
    expect(r.classifiable).toBe(false);
    expect(r.dataLimited).toBe(true);
    expect(r.trend).toBe('SIDEWAYS');
    expect(r.asOf).toBeNull();
  });

  it('DB 예외 → graceful 빈 표본(throw 전파 없음)', async () => {
    const svc = new MarketRegimeService(
      mockPrisma({ throwIndex: true, throwEvents: true }),
    );
    const r = await svc.getCurrentRegime();
    expect(r.indexSampleSize).toBe(0);
    expect(r.eventSampleSize).toBe(0);
    expect(r.dataLimited).toBe(true);
  });

  it('적재 → 결정론적 분류(상승추세·호재 우세)', async () => {
    const closes = Array.from({ length: 35 }, (_, i) => 2500 + i * 5); // 우상향
    const svc = new MarketRegimeService(
      mockPrisma({
        indexCloses: closes,
        latestDate: '20260608',
        polarityGroups: [
          { polarity: 'POSITIVE', count: 40 },
          { polarity: 'NEGATIVE', count: 10 },
          { polarity: 'UNKNOWN', count: 5 },
        ],
      }),
    );
    const r = await svc.getCurrentRegime();
    expect(r.indexSampleSize).toBe(35);
    expect(r.trend).toBe('UPTREND');
    expect(r.eventSkew).toBe('OPPORTUNITY');
    expect(r.eventSampleSize).toBe(55);
    expect(r.dataLimited).toBe(false);
    expect(r.asOf).toBe('20260608');
  });

  it('극성 분류: 알 수 없는 polarity 문자열 → unknown 버킷', async () => {
    const svc = new MarketRegimeService(
      mockPrisma({
        indexCloses: [2500, 2510],
        polarityGroups: [{ polarity: 'WEIRD', count: 7 }],
      }),
    );
    const r = await svc.getCurrentRegime();
    expect(r.eventPolarity.unknown).toBe(7);
  });
});
