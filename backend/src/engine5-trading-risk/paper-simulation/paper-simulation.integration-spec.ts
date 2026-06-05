/**
 * paper-simulation.integration-spec.ts — 실 Postgres 통합테스트 (DAR-40)
 *
 * PaperSimulationService.runDailyCycle 한 사이클(매수→스냅샷→Exit평가→지표)을 실 dev DB로
 * 검증한다. BUY 신호 1건을 시드하면 모의 매수(Position/PaperTrade)·일일 스냅샷·ExitSignal·
 * 누적지표가 생성되는지 확인.
 *
 * ★ 격리: withRollback 안에서 FK 부모(Company→Disclosure→Price→TradingSignal→Thesis)와
 *   sim 포트폴리오를 만들고 사이클 실행 후 전부 롤백. 데모 DB 잔여 row 0(주가 2767·공시 무변경).
 *   실행: npm run test:integration.
 *
 * AI 금지영역: 매수점수·Exit·체결은 순수 Rule. 본 테스트도 AI 미개입.
 */

import { PaperSimulationService } from './paper-simulation.service';
import { PaperTradeService } from '../services/paper-trade.service';
import { PrismaPaperTradeRepository } from '../repositories/prisma-paper-trade.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { withRollback } from '../../../test/integration/with-rollback';

const prisma = new PrismaService();
const TAG = 'DAR40_SIM';
const TRADE_DATE = '20260515';

async function seedBuyCandidate(tx: any): Promise<{ corpCode: string }> {
  const corpCode = `${TAG}_CORP`;
  const rcpNo = `${TAG}_RCP`;
  const stockCode = '404040';
  await tx.company.create({
    data: { corpCode, corpName: 'DAR40모의운용사', stockCode, market: 'KOSDAQ' },
  });
  await tx.disclosure.create({
    data: {
      rcpNo, corpCode, corpName: 'DAR40모의운용사', reportName: '단일판매ㆍ공급계약체결',
      rcpDt: '20260514', flrName: 'DAR40모의운용사', rmk: '', disclosureType: '주요사항보고',
    },
  });
  await tx.stockDailyPrice.create({
    data: {
      corpCode, stockCode, tradeDate: TRADE_DATE,
      openPrice: 49000, highPrice: 51000, lowPrice: 48500, closePrice: 50000,
      volume: BigInt(1_000_000), tradingValue: BigInt(50_000_000_000),
    },
  });
  const signal = await tx.tradingSignal.create({
    data: {
      rcpNo, corpCode, stockCode, eventType: 'SUPPLY_CONTRACT', persona: 'BALANCED',
      buyScore: 72, signal: 'BUY_CANDIDATE', scoreBreakdown: {}, riskPenalty: 0,
      entryConditionMet: ['거래량 충족'], entryConditionUnmet: [], entryReady: true,
      riskFactors: [],
    },
  });
  await tx.positionThesis.create({
    data: {
      tradingSignalId: signal.id, rcpNo, corpCode,
      entryReason: '공급계약 호재', initialThesis: ['수주 확대'],
      invalidConditions: [{ type: 'PRICE_BELOW', value: 45000 }],
      exitRules: [{ type: 'STOP_LOSS_PCT', value: 8 }, { type: 'MAX_HOLD_DAYS', value: 20 }],
    },
  });
  return { corpCode };
}

function buildService(tx: any): PaperSimulationService {
  const paperTrade = new PaperTradeService(
    new PrismaPaperTradeRepository(tx as unknown as PrismaService),
  );
  return new PaperSimulationService(tx as unknown as PrismaService, paperTrade);
}

describe('PaperSimulationService.runDailyCycle (실 Postgres 통합)', () => {
  let positionBaseline: number;
  let paperTradeBaseline: number;

  beforeAll(async () => {
    await prisma.$connect();
    positionBaseline = await prisma.position.count();
    paperTradeBaseline = await prisma.paperTrade.count();
  });

  afterAll(async () => {
    // 격리 증명: 롤백 후 잔여 0
    expect(await prisma.position.count()).toBe(positionBaseline);
    expect(await prisma.paperTrade.count()).toBe(paperTradeBaseline);
    await prisma.$disconnect();
  });

  it('BUY 후보 1건 → 모의 매수·일일 스냅샷·ExitSignal·지표 한 사이클 생성', async () => {
    const out = await withRollback(prisma, async (tx) => {
      await seedBuyCandidate(tx);
      const svc = buildService(tx);
      const result = await svc.runDailyCycle(TRADE_DATE);

      const pf = await svc.getOrCreateSimPortfolio();
      const positions = await tx.position.findMany({ where: { portfolioId: pf.id } });
      const paperTrades = await tx.paperTrade.findMany({ where: { corpCode: `${TAG}_CORP` } });
      const snapshots = positions.length
        ? await tx.positionDailySnapshot.findMany({ where: { positionId: positions[0].id } })
        : [];
      const exitSignals = positions.length
        ? await tx.exitSignal.findMany({ where: { positionId: positions[0].id } })
        : [];
      return { result, positions, paperTrades, snapshots, exitSignals };
    });

    // 매수: Position 1 + BUY PaperTrade 1 (슬리피지 반영)
    expect(out.result.bought).toBe(1);
    expect(out.positions).toHaveLength(1);
    expect(out.positions[0].status).toBe('OPEN');
    expect(out.positions[0].quantity).toBeGreaterThan(0);
    expect(out.paperTrades.some((t: any) => t.direction === 'BUY')).toBe(true);

    // 스냅샷: 일일 시가평가 1건
    expect(out.result.snapshotted).toBe(1);
    expect(out.snapshots).toHaveLength(1);
    expect(out.snapshots[0].snapshotDate).toBe(TRADE_DATE);
    expect(Number(out.snapshots[0].positionValue)).toBeGreaterThan(0);

    // Exit 평가: ExitSignal 1건, aiUsed=false (AI 개입 0)
    expect(out.exitSignals).toHaveLength(1);
    expect(out.exitSignals[0].aiUsed).toBe(false);

    // 지표: 표본 부족 → 적중률/Exit정확도 null(정직 표기), 평가자산·누적수익률 산출
    expect(out.result.metrics.hitRateD5).toBeNull();
    expect(out.result.metrics.exitAccuracyD3).toBeNull();
    expect(out.result.openPositions).toBe(1);
    expect(typeof out.result.equity).toBe('number');
  });

  it('BUY 후보 없으면 매수 0 — 빈 사이클도 안전', async () => {
    const result = await withRollback(prisma, async (tx) => {
      const svc = buildService(tx);
      return svc.runDailyCycle(TRADE_DATE);
    });
    expect(result.bought).toBe(0);
    expect(result.snapshotted).toBe(0);
    expect(result.exited).toBe(0);
  });
});
