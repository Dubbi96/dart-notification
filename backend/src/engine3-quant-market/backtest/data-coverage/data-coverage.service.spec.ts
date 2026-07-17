import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { DataCoverageService } from './data-coverage.service';

/**
 * 서비스 배선 검증(DB 무의존) — $queryRaw 를 목킹해 집계행 → 리포트 조립 경로를 결정론적으로 확인한다.
 * 실제 SQL·달력 산출은 순수 빌더/달력 SSOT 스펙이 별도로 고정한다.
 */
describe('DataCoverageService (DAR-544 — 배선/read-only)', () => {
  function makeService(priceRows: unknown[], disclosureRows: unknown[]) {
    const queryRaw = jest
      .fn()
      .mockResolvedValueOnce(priceRows) // Promise.all 1번째 = 가격 집계
      .mockResolvedValueOnce(disclosureRows); // 2번째 = 공시 집계
    const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
    return { service: new DataCoverageService(prisma), queryRaw };
  }

  it('집계행을 리포트로 조립하고, 쓰기 없이 SELECT 2건만 실행한다', async () => {
    const { service, queryRaw } = makeService(
      [{ year: '2015', rows: BigInt(612500), tradingDays: BigInt(245), stocks: BigInt(2500) }],
      [{ year: '2015', rows: BigInt(30000), corps: BigInt(2400) }],
    );

    const report = await service.audit({
      startYear: 2015,
      endYear: 2015,
      asOfCompact: '20151231',
    });

    // 집계 질의는 정확히 2건(가격·공시), 어떤 쓰기도 없다.
    expect(queryRaw).toHaveBeenCalledTimes(2);
    expect(report.window).toEqual({ startYear: 2015, endYear: 2015 });
    expect(report.summary.totalPriceRows).toBe(612500);
    expect(report.summary.totalDisclosureRows).toBe(30000);
    const y = report.years[0];
    expect(y.price.distinctStocks).toBe(2500);
    expect(y.disclosure.distinctCorps).toBe(2400);
    // 2015 실기대 거래일(달력 SSOT)로 충족률이 산출된다(정확값은 달력 스펙 소관).
    expect(y.price.expectedTradingDays).toBeGreaterThan(200);
    expect(typeof y.price.coveragePct).toBe('number');
    // 2015 는 달력(KRX_HOLIDAYS) 미등재 → 충족률% 비신뢰, 상태는 실거래일 하한(245≥240)으로 FULL.
    expect(y.price.coveragePctReliable).toBe(false);
    expect(y.isFullYear).toBe(true);
    expect(y.status).toBe('FULL');
  });

  it('결측 연도는 0으로 채워지고 리포트 판정에 반영된다', async () => {
    const { service } = makeService(
      [{ year: '2015', rows: BigInt(612500), tradingDays: BigInt(245), stocks: BigInt(2500) }],
      [{ year: '2015', rows: BigInt(30000), corps: BigInt(2400) }],
    );
    const report = await service.audit({
      startYear: 2015,
      endYear: 2016,
      asOfCompact: '20161231',
    });
    expect(report.years).toHaveLength(2);
    const y2016 = report.years.find((y) => y.year === 2016)!;
    expect(y2016.status).toBe('MISSING');
    expect(report.summary.missingYears).toEqual([2016]);
    expect(report.summary.gateReady).toBe(false);
  });

  it('유효하지 않은 연도 창은 BadRequest', async () => {
    const { service } = makeService([], []);
    await expect(service.audit({ startYear: 2026, endYear: 2015 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
