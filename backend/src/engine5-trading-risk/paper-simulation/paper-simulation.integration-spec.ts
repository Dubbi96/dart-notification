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
import { entryEligibleGrades, ENTRY_FALLBACK_MIN_BUY_SCORE } from './simulation-entry';

const prisma = new PrismaService();
const TAG = 'DAR40_SIM';
const TRADE_DATE = '20260515'; // 금 — 신호일(D0, 예약)
const FILL_DATE = '20260518'; // 월 — 다음 거래일(D+1, 당일 시가 체결)

/**
 * DAR-539: 공유 데모 DB 격리. 이 스펙은 'tx 안에 seed 한 후보만 존재'를 가정하지만,
 *   ① runDailyCycle 의 후보 선정(openNewPositions)은 tradeDate 필터가 없어 DB 전역의
 *      적격(entryReady 또는 buyScore≥fallback) BUY-급 신호를 모두 집고,
 *   ② sim 포트폴리오(SIM_USER_EMAIL + SIM_PORTFOLIO_NAME 규약키)에도 데모 사이클이 남긴
 *      보유·예약이 누적돼 있어, 예약/체결/보유 건수가 데모 데이터 양에 따라 오염된다
 *      (관측: reserved 9 — 코드 회귀 아님, 환경 의존 flake).
 *   withRollback tx 안에서 (a) 기존 sim 포트폴리오를 다른 이름으로 '주차'시켜
 *   getOrCreateSimPortfolio 가 빈 포트폴리오를 새로 만들게 하고, (b) 선정 가능한 기존 적격
 *   신호를 진입 부적격 등급(BLOCKED)으로 눌러 후보 pool 을 seed 로 한정한다. 두 변경 모두
 *   ROLLBACK 센티넬로 전량 롤백되어 데모 DB 는 무손상(afterAll 잔여 0 불변식 유지).
 *   ※ 후보 쿼리에 날짜 창이 없으므로 'seed 를 원거리 미래일로 이동'만으로는 격리 불가 —
 *     전역 pool 무력화가 필요하다.
 */
async function isolateFromDemoData(tx: any): Promise<void> {
  // (a) 데모 sim 포트폴리오 주차 → 서비스가 빈 포트폴리오를 신규 생성하도록 유도.
  await tx.portfolio.updateMany({
    where: { name: PaperSimulationService.SIM_PORTFOLIO_NAME },
    data: { name: `__DAR539_PARKED__${PaperSimulationService.SIM_PORTFOLIO_NAME}` },
  });
  // (b) 선정 가능한(primary: entryReady / fallback: buyScore≥50) 적격 신호를 등급 강등해 후보 pool 무력화.
  await tx.tradingSignal.updateMany({
    where: {
      signal: { in: entryEligibleGrades() as never[] },
      OR: [{ entryReady: true }, { buyScore: { gte: ENTRY_FALLBACK_MIN_BUY_SCORE } }],
    },
    data: { signal: 'BLOCKED' },
  });
}

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
      await isolateFromDemoData(tx); // DAR-539: 공유 데모 DB 오염 차단(seed 전에 pool·포트폴리오 격리)
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
      await isolateFromDemoData(tx); // DAR-539: 후보 seed 없음 — 데모 pool 격리로 진짜 '빈 사이클' 재현
      const svc = buildService(tx);
      return svc.runDailyCycle(TRADE_DATE);
    });
    expect(result.reserved).toBe(0);
    expect(result.bought).toBe(0);
    expect(result.snapshotted).toBe(0);
    expect(result.exited).toBe(0);
  });
});
