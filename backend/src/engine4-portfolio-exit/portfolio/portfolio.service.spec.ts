/**
 * portfolio.service.spec.ts — 헤드라인 총수익률 분모 회귀 (DAR-184)
 *
 * 버그: totalPnlPercent 분모가 원가(entryAmount 합)가 아니라 평가금액(currentValue 합)이었다.
 * 수익률 정의는 손익/원가 = (평가-원가)/원가. 평가금액 분모는 이익 과소·손실 과대 평가를 유발.
 * 실제 DB 없이 PrismaService aggregate만 스텁한 순수 산술 검증.
 */

import { PortfolioService } from './portfolio.service';
import type { PrismaService } from '../../prisma/prisma.service';

interface AggSum {
  currentValue: number | null;
  unrealizedPnl: number | null;
  entryAmount: number | null;
}

function makeService(aggSum: AggSum) {
  const prisma = {
    portfolio: {
      findFirst: jest.fn().mockResolvedValue({ riskSnapshots: [] }),
    },
    position: {
      aggregate: jest.fn().mockResolvedValue({ _sum: aggSum }),
    },
  } as unknown as PrismaService;

  return new PortfolioService(prisma);
}

describe('PortfolioService.findPortfolioSummary — 총수익률 분모(DAR-184)', () => {
  it('이익 구간: 원가100→평가110(손익+10)이면 +10% (분모=원가)', async () => {
    const service = makeService({ currentValue: 110, unrealizedPnl: 10, entryAmount: 100 });
    const summary = await service.findPortfolioSummary('user-1');

    expect(summary.totalPnl).toBe(10);
    expect(summary.totalPnlPercent).toBeCloseTo(10, 6);
    // 평가금액 분모였다면 +9.09%로 과소 평가됐을 것.
    expect(summary.totalPnlPercent).not.toBeCloseTo(9.0909, 3);
  });

  it('손실 구간: 원가100→평가50(손익-50)이면 -50% (분모=원가, -100% 아님)', async () => {
    const service = makeService({ currentValue: 50, unrealizedPnl: -50, entryAmount: 100 });
    const summary = await service.findPortfolioSummary('user-1');

    expect(summary.totalPnl).toBe(-50);
    expect(summary.totalPnlPercent).toBeCloseTo(-50, 6);
    // 평가금액 분모였다면 -100%로 손실을 과대 평가했을 것.
    expect(summary.totalPnlPercent).not.toBeCloseTo(-100, 3);
  });

  it('다종목 합산: 원가합200·손익합+30이면 +15%', async () => {
    const service = makeService({ currentValue: 230, unrealizedPnl: 30, entryAmount: 200 });
    const summary = await service.findPortfolioSummary('user-1');

    expect(summary.totalPnlPercent).toBeCloseTo(15, 6);
  });

  it('원가 합이 0(포지션 없음)이면 0% — 0 나눗셈 방지', async () => {
    const service = makeService({ currentValue: 0, unrealizedPnl: 0, entryAmount: 0 });
    const summary = await service.findPortfolioSummary('user-1');

    expect(summary.totalPnlPercent).toBe(0);
  });

  it('entryAmount 합이 null(미집계)이어도 0%로 안전 폴백', async () => {
    const service = makeService({ currentValue: null, unrealizedPnl: null, entryAmount: null });
    const summary = await service.findPortfolioSummary('user-1');

    expect(summary.totalValue).toBe(0);
    expect(summary.totalPnl).toBe(0);
    expect(summary.totalPnlPercent).toBe(0);
  });
});
