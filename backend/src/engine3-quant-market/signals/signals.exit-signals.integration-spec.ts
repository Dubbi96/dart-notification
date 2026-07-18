/**
 * signals.exit-signals.integration-spec.ts — 실 Postgres 통합테스트 (DAR-559)
 *
 * findExitSignals()가 이전엔 where·take·사용자 스코프 없이 exit_signals 전량을 조회해
 * (1) 타 사용자의 청산 신호가 노출되고 (2) 수천 행 응답이 모바일 axios 10s를 넘겨
 * 매도 탭이 "백엔드 연결 실패"로 낙하했다(§0 P0 연관 가설).
 *
 * 이 스펙은 실 DB로 (a) position→portfolio.userId 스코프, (b) status=OPEN 한정,
 * (c) positionId당 최신 1건만 반환(distinct+orderBy dedupe)을 검증한다.
 *
 * ★ 격리: withRollback 안에서 FK 부모(User→Portfolio→Company→Position→ExitSignal) 생성 후 롤백.
 *   잔여 row 0. 실행: npm run test:integration.
 */

import { SignalsService } from './signals.service';
import { PrismaService } from '../../prisma/prisma.service';
import { withRollback } from '../../../test/integration/with-rollback';

const prisma = new PrismaService();
const TAG = 'DAR559_ES';

async function seedUserPortfolio(tx: any, tag: string) {
  const user = await tx.user.create({
    data: { email: `${tag.toLowerCase()}@test.local`, provider: 'local' },
  });
  const portfolio = await tx.portfolio.create({
    data: { userId: user.id, name: '통합테스트 포트폴리오' },
  });
  return { user, portfolio };
}

async function seedPosition(
  tx: any,
  portfolioId: string,
  corpCode: string,
  status: 'OPEN' | 'CLOSED',
) {
  await tx.company.create({
    data: { corpCode, corpName: `${corpCode}사`, stockCode: corpCode.slice(-6), market: 'KOSDAQ' },
  });
  return tx.position.create({
    data: {
      portfolioId,
      corpCode,
      stockCode: corpCode.slice(-6),
      entryDate: new Date('2026-01-02T00:00:00.000Z'),
      entryPrice: 50000,
      quantity: 10,
      entryAmount: 500000,
      status,
      ...(status === 'CLOSED' ? { closedAt: new Date('2026-01-05T00:00:00.000Z') } : {}),
    },
  });
}

const SCORE_FIELDS = {
  lossRiskScore: 10,
  thesisBreakScore: 10,
  chartBreakScore: 0,
  disclosureRiskScore: 0,
  overweightScore: 0,
  timeExceededScore: 0,
  positiveMomentumBonus: 0,
};

function seedExitSignal(tx: any, positionId: string, exitScore: number, createdAt: Date) {
  return tx.exitSignal.create({
    data: {
      positionId,
      checkTime: 'INTRADAY',
      ...SCORE_FIELDS,
      exitScore,
      exitAction: 'REDUCE',
      triggerTypes: ['STOP_LOSS'],
      scoreDetail: {},
      createdAt,
      checkedAt: createdAt,
    },
  });
}

describe('SignalsService.findExitSignals (실 Postgres 통합, DAR-559)', () => {
  let baselineCount: number;

  beforeAll(async () => {
    await prisma.$connect();
    baselineCount = await prisma.exitSignal.count();
  });

  afterAll(async () => {
    const finalCount = await prisma.exitSignal.count();
    expect(finalCount).toBe(baselineCount); // 잔여 0
    await prisma.$disconnect();
  });

  it('사용자 스코프: 요청자 소유 포지션의 신호만 반환하고 타 사용자 신호는 제외한다', async () => {
    const result = await withRollback(prisma, async (tx) => {
      const service = new SignalsService(tx as unknown as PrismaService);
      const { user: userA, portfolio: portfolioA } = await seedUserPortfolio(tx, `${TAG}_A`);
      const { portfolio: portfolioB } = await seedUserPortfolio(tx, `${TAG}_B`);

      const posA = await seedPosition(tx, portfolioA.id, `${TAG}_A_CORP`, 'OPEN');
      const posB = await seedPosition(tx, portfolioB.id, `${TAG}_B_CORP`, 'OPEN');
      await seedExitSignal(tx, posA.id, 40, new Date('2026-01-10T00:00:00.000Z'));
      await seedExitSignal(tx, posB.id, 90, new Date('2026-01-10T00:00:00.000Z'));

      return service.findExitSignals(userA.id);
    });

    expect(result).toHaveLength(1);
    expect(result[0].corpCode).toBe(`${TAG}_A_CORP`);
    expect(result[0].exitScore).toBe(40);
  });

  it('OPEN 한정: CLOSED 포지션의 청산 신호는 제외한다', async () => {
    const result = await withRollback(prisma, async (tx) => {
      const service = new SignalsService(tx as unknown as PrismaService);
      const { user, portfolio } = await seedUserPortfolio(tx, `${TAG}_CLOSED`);
      const posOpen = await seedPosition(tx, portfolio.id, `${TAG}_OPEN_CORP`, 'OPEN');
      const posClosed = await seedPosition(tx, portfolio.id, `${TAG}_CLOSED_CORP`, 'CLOSED');
      await seedExitSignal(tx, posOpen.id, 30, new Date('2026-01-10T00:00:00.000Z'));
      await seedExitSignal(tx, posClosed.id, 99, new Date('2026-01-10T00:00:00.000Z'));

      return service.findExitSignals(user.id);
    });

    expect(result).toHaveLength(1);
    expect(result[0].corpCode).toBe(`${TAG}_OPEN_CORP`);
  });

  it('positionId당 최신 1건: 같은 포지션에 신호 2건이면 더 최근(createdAt) 1건만 반환한다', async () => {
    const result = await withRollback(prisma, async (tx) => {
      const service = new SignalsService(tx as unknown as PrismaService);
      const { user, portfolio } = await seedUserPortfolio(tx, `${TAG}_DEDUPE`);
      const pos = await seedPosition(tx, portfolio.id, `${TAG}_DEDUPE_CORP`, 'OPEN');
      await seedExitSignal(tx, pos.id, 20, new Date('2026-01-08T00:00:00.000Z')); // older
      await seedExitSignal(tx, pos.id, 55, new Date('2026-01-12T00:00:00.000Z')); // latest

      return service.findExitSignals(user.id);
    });

    expect(result).toHaveLength(1);
    expect(result[0].exitScore).toBe(55); // 최신 행만 보존
  });

  it('격리 증명: 롤백 후 메인 커넥션에서 이 스펙의 신호/포지션 잔여 0', async () => {
    const corpCode = `${TAG}_ISO_CORP`;
    await withRollback(prisma, async (tx) => {
      const { portfolio } = await seedUserPortfolio(tx, `${TAG}_ISO`);
      const pos = await seedPosition(tx, portfolio.id, corpCode, 'OPEN');
      await seedExitSignal(tx, pos.id, 10, new Date());
    });
    const leaked = await prisma.position.findMany({ where: { corpCode } });
    expect(leaked).toHaveLength(0);
  });
});
