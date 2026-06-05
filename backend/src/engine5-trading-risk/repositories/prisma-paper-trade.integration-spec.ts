/**
 * prisma-paper-trade.integration-spec.ts — 실 Postgres 통합테스트 (DAR-38)
 *
 * PrismaPaperTradeRepository를 실 dev DB로 save→find 왕복 검증한다.
 * 핵심: 컬럼명 매핑(도메인 slippageCost ↔ DB slippage)과 Decimal 컬럼
 * (fillRate/entryPrice/.../returnPct)의 number 왕복 정밀도를 실DB에서 확인.
 *
 * ★ 격리: withRollback 안에서 FK 부모(Company) 생성 후 롤백. 잔여 row 0.
 *   tradingSignalId/positionThesisId는 null(optional)로 두어 fixture를 단순화.
 *   실행: npm run test:integration.
 */

import { PrismaPaperTradeRepository } from './prisma-paper-trade.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { withRollback } from '../../../test/integration/with-rollback';
import type { PaperTradeRecord } from './paper-trade.repository';

const prisma = new PrismaService();
const TAG = 'DAR38_PT5';

async function seedCompany(tx: any): Promise<string> {
  const corpCode = `${TAG}_CORP`;
  await tx.company.create({
    data: { corpCode, corpName: '모의체결사', stockCode: '777777', market: 'KOSPI' },
  });
  return corpCode;
}

function buildTrade(corpCode: string): Omit<PaperTradeRecord, 'id' | 'createdAt'> {
  return {
    corpCode,
    stockCode: '777777',
    direction: 'BUY',
    orderedShares: 100,
    filledShares: 95,
    fillRate: 0.95, // Decimal(5,4)
    entryPrice: 70000.5, // Decimal(12,2)
    filledPrice: 70150.25,
    commission: 105.5,
    tax: 0,
    slippageCost: 142.75, // → DB 컬럼 slippage
    grossPnl: 14250.0,
    netPnl: 14001.75,
    returnPct: 1.2345, // Decimal(8,4)
    status: 'FILLED',
    entryDate: new Date('2026-01-05T00:00:00.000Z'),
    filledAt: new Date('2026-01-05T00:01:00.000Z'),
    tradingSignalId: null,
    positionThesisId: null,
  };
}

describe('PrismaPaperTradeRepository (실 Postgres 통합)', () => {
  let baselineCount: number;

  beforeAll(async () => {
    await prisma.$connect();
    baselineCount = await prisma.paperTrade.count();
  });

  afterAll(async () => {
    const finalCount = await prisma.paperTrade.count();
    expect(finalCount).toBe(baselineCount); // 잔여 0
    await prisma.$disconnect();
  });

  it('save → findById 왕복: slippageCost↔slippage 매핑 + Decimal number 정밀도 보존', async () => {
    const { saved, found, rawSlippage } = await withRollback(prisma, async (tx) => {
      const repo = new PrismaPaperTradeRepository(tx as unknown as PrismaService);
      const corpCode = await seedCompany(tx);
      const saved = await repo.save(buildTrade(corpCode));
      const found = await repo.findById(saved.id);
      // 도메인 slippageCost가 실제로 DB의 slippage 컬럼에 들어갔는지 직접 확인
      const rawRow = await tx.paperTrade.findUniqueOrThrow({
        where: { id: saved.id },
      });
      return { saved, found, rawSlippage: Number(rawRow.slippage) };
    });

    expect(found).not.toBeNull();
    expect(found!.id).toBe(saved.id);
    expect(found!.corpCode).toBe(`${TAG}_CORP`);
    expect(found!.direction).toBe('BUY');
    expect(found!.orderedShares).toBe(100);
    expect(found!.filledShares).toBe(95);
    expect(found!.fillRate).toBe(0.95);
    expect(found!.entryPrice).toBe(70000.5);
    expect(found!.filledPrice).toBe(70150.25);
    expect(found!.commission).toBe(105.5);
    expect(found!.tax).toBe(0);
    expect(found!.slippageCost).toBe(142.75);
    expect(found!.grossPnl).toBe(14250.0);
    expect(found!.netPnl).toBe(14001.75);
    expect(found!.returnPct).toBe(1.2345);
    expect(found!.status).toBe('FILLED');
    // 컬럼명 매핑 직접 증명: DB slippage 컬럼 == 도메인 slippageCost
    expect(rawSlippage).toBe(142.75);
  });

  it('findByStatus: enum 상태 조회로 저장한 trade가 결과에 포함', async () => {
    const { savedId, byStatus } = await withRollback(prisma, async (tx) => {
      const repo = new PrismaPaperTradeRepository(tx as unknown as PrismaService);
      const corpCode = await seedCompany(tx);
      const saved = await repo.save(buildTrade(corpCode));
      const byStatus = await repo.findByStatus('FILLED');
      return { savedId: saved.id, byStatus };
    });

    expect(byStatus.map((t) => t.id)).toContain(savedId);
  });

  it('격리 증명: 롤백 후 메인 커넥션에서 해당 trade id 조회 시 null', async () => {
    const savedId = await withRollback(prisma, async (tx) => {
      const repo = new PrismaPaperTradeRepository(tx as unknown as PrismaService);
      const corpCode = await seedCompany(tx);
      const saved = await repo.save(buildTrade(corpCode));
      return saved.id;
    });
    const leaked = await prisma.paperTrade.findUnique({ where: { id: savedId } });
    expect(leaked).toBeNull();
  });
});
