/**
 * paper-simulation.integration-spec.ts — 실 Postgres 통합테스트 (DAR-40 + 장외 체결 의미론 2026-07)
 *
 * PaperSimulationService.runDailyCycle 를 실 dev DB로 2사이클 검증한다:
 *   D0(신호일): BUY 후보 → 매수 '예약'(PENDING PaperTrade, 즉시 체결 0)
 *   D+1(다음 거래일): 예약 → 당일 시가 체결(Position 생성)·스냅샷·ExitSignal·지표.
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
const TRADE_DATE = '20260515'; // 금 — 신호일(D0, 예약)
const FILL_DATE = '20260518'; // 월 — 다음 거래일(D+1, 당일 시가 체결)

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
  // D+1 일봉 — 개장 체결기의 '당일 시가'(REAL 폴백 경로) 데이터.
  await tx.stockDailyPrice.create({
    data: {
      corpCode, stockCode, tradeDate: FILL_DATE,
      openPrice: 50500, highPrice: 52000, lowPrice: 50000, closePrice: 51000,
      volume: BigInt(1_200_000), tradingValue: BigInt(60_000_000_000),
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

  it('BUY 후보 1건 → D0 예약(PENDING) → D+1 당일 시가 체결·스냅샷·ExitSignal·지표', async () => {
    const out = await withRollback(prisma, async (tx) => {
      await seedBuyCandidate(tx);
      const svc = buildService(tx);
      // D0: 예약만(즉시 체결 금지 — 장외 체결 의미론).
      const d0 = await svc.runDailyCycle(TRADE_DATE);
      const pendingAfterD0 = await tx.paperTrade.findMany({
        where: { corpCode: `${TAG}_CORP`, status: 'PENDING' },
      });
      const positionsAfterD0 = await tx.position.count({
        where: { corpCode: `${TAG}_CORP` },
      });
      // D+1: 당일 시가 체결(폴백 경로 — 당일 REAL 일봉 open).
      const result = await svc.runDailyCycle(FILL_DATE);

      const pf = await svc.getOrCreateSimPortfolio();
      const positions = await tx.position.findMany({ where: { portfolioId: pf.id } });
      const paperTrades = await tx.paperTrade.findMany({ where: { corpCode: `${TAG}_CORP` } });
      const snapshots = positions.length
        ? await tx.positionDailySnapshot.findMany({ where: { positionId: positions[0].id } })
        : [];
      const exitSignals = positions.length
        ? await tx.exitSignal.findMany({ where: { positionId: positions[0].id } })
        : [];
      // DAR-42: 모바일 표시용 status 응답(보유 포지션 상세 포함)도 같은 tx 로 검증
      const status = await svc.getSimulationStatus();
      return { d0, pendingAfterD0, positionsAfterD0, result, positions, paperTrades, snapshots, exitSignals, status };
    });

    // D0: 예약 1건(PENDING)·Position 0 — 당일 종가 즉시 체결이 없어야 한다(상향 편향 차단).
    expect(out.d0.reserved).toBe(1);
    expect(out.d0.bought).toBe(0);
    expect(out.pendingAfterD0).toHaveLength(1);
    expect(out.positionsAfterD0).toBe(0);

    // D+1 체결: Position 1 + BUY PaperTrade(FILLED, 당일 시가 기준 체결가)
    expect(out.result.bought).toBe(1);
    expect(out.positions).toHaveLength(1);
    expect(out.positions[0].status).toBe('OPEN');
    expect(out.positions[0].quantity).toBeGreaterThan(0);
    // 체결가는 D+1 시가(50500) 이상(슬리피지 BUY 상향) — D0 종가(50000)가 아니다.
    expect(out.positions[0].entryPrice).toBeGreaterThanOrEqual(50500);
    const buyTrade = out.paperTrades.find((t: any) => t.direction === 'BUY');
    expect(buyTrade).toBeDefined();
    expect(['FILLED', 'PARTIAL']).toContain((buyTrade as any).status);

    // 스냅샷: 체결일(D+1) 일일 시가평가 1건
    expect(out.result.snapshotted).toBe(1);
    expect(out.snapshots).toHaveLength(1);
    expect(out.snapshots[0].snapshotDate).toBe(FILL_DATE);
    expect(Number(out.snapshots[0].positionValue)).toBeGreaterThan(0);

    // Exit 평가: ExitSignal 1건, aiUsed=false (AI 개입 0)
    expect(out.exitSignals).toHaveLength(1);
    expect(out.exitSignals[0].aiUsed).toBe(false);

    // 지표: 표본 부족 → 적중률/Exit정확도 null(정직 표기), 평가자산·누적수익률 산출
    expect(out.result.metrics.hitRateD5).toBeNull();
    expect(out.result.metrics.exitAccuracyD3).toBeNull();
    expect(out.result.openPositions).toBe(1);
    expect(typeof out.result.equity).toBe('number');

    // DAR-42 status: 보유 포지션 상세(종목·수량·평가손익)·청산수·초기원금 반영
    expect(out.status.openPositionCount).toBe(1);
    expect(out.status.positions).toHaveLength(1);
    expect(out.status.positions[0].corpName).toBe('DAR40모의운용사');
    expect(out.status.positions[0].stockCode).toBe('404040');
    expect(out.status.positions[0].quantity).toBeGreaterThan(0);
    expect(out.status.positions[0].currentValue).toBeGreaterThan(0);
    expect(out.status.closedPositions).toBe(0);
    expect(out.status.initialCapital).toBe(10_000_000);
  });

  it('BUY 후보 없으면 예약·매수 0 — 빈 사이클도 안전', async () => {
    const result = await withRollback(prisma, async (tx) => {
      const svc = buildService(tx);
      return svc.runDailyCycle(TRADE_DATE);
    });
    expect(result.reserved).toBe(0);
    expect(result.bought).toBe(0);
    expect(result.snapshotted).toBe(0);
    expect(result.exited).toBe(0);
  });
});
