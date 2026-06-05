/**
 * prisma-exit-signal.integration-spec.ts — 실 Postgres 통합테스트 (DAR-38)
 *
 * PrismaExitSignalRepository를 실 dev DB로 save→findLatestByPositionId 왕복 검증한다.
 * Exit Score 7개 컴포넌트가 개별 컬럼으로, triggerTypes(enum 배열)가 String[]로,
 * primaryTrigger가 triggerType(enum?)로 매핑되는지 + aiUsed=false 강제(AI 개입 0) 확인.
 *
 * ★ 격리: withRollback 안에서 FK 부모(User→Portfolio→Company→Position) 생성 후 롤백.
 *   잔여 row 0. 실행: npm run test:integration.
 */

import { PrismaExitSignalRepository } from './prisma-exit-signal.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { withRollback } from '../../../test/integration/with-rollback';
import type { CreateExitSignalParams } from './exit-signal.repository';
import type { ExitScoreComponents } from '../domain/exit-engine.types';

const prisma = new PrismaService();
const TAG = 'DAR38_ES';

/** FK 부모(User→Portfolio→Company→Position) 생성 후 positionId 반환 */
async function seedPosition(tx: any): Promise<string> {
  const corpCode = `${TAG}_CORP`;
  const user = await tx.user.create({
    data: { email: `${TAG.toLowerCase()}@test.local`, provider: 'local' },
  });
  const portfolio = await tx.portfolio.create({
    data: { userId: user.id, name: '통합테스트 포트폴리오' },
  });
  await tx.company.create({
    data: { corpCode, corpName: '청산테스트사', stockCode: '888888', market: 'KOSDAQ' },
  });
  const position = await tx.position.create({
    data: {
      portfolioId: portfolio.id,
      corpCode,
      stockCode: '888888',
      entryDate: new Date('2026-01-02T00:00:00.000Z'),
      entryPrice: 50000,
      quantity: 10,
      entryAmount: 500000,
      status: 'OPEN',
    },
  });
  return position.id;
}

const COMPONENTS: ExitScoreComponents = {
  lossRiskScore: 12,
  thesisBreakScore: 15,
  chartBreakScore: 8,
  disclosureRiskScore: 5,
  overweightScore: 3,
  timeExceededScore: 4,
  positiveMomentumBonus: 2,
};

function buildParams(positionId: string): CreateExitSignalParams {
  return {
    positionId,
    checkTime: 'INTRADAY',
    components: COMPONENTS,
    exitScore: 45,
    exitAction: 'REDUCE',
    triggerTypes: ['STOP_LOSS', 'THESIS_INVALIDATED'],
    primaryTrigger: 'THESIS_INVALIDATED',
    scoreDetail: { note: '논리 훼손 + 손실 리스크 동반' },
  };
}

describe('PrismaExitSignalRepository (실 Postgres 통합)', () => {
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

  it('save: id 반환 + 7개 컴포넌트 컬럼/enum/triggerTypes/aiUsed=false 실DB 저장', async () => {
    const { id, raw } = await withRollback(prisma, async (tx) => {
      const repo = new PrismaExitSignalRepository(tx as unknown as PrismaService);
      const positionId = await seedPosition(tx);
      const { id } = await repo.save(buildParams(positionId));
      // 어댑터 매핑을 우회해 실제 저장된 row를 직접 읽어 컬럼 매핑 검증
      const raw = await tx.exitSignal.findUniqueOrThrow({ where: { id } });
      return { id, raw };
    });

    expect(id).toBeTruthy();
    expect(raw.lossRiskScore).toBe(12);
    expect(raw.thesisBreakScore).toBe(15);
    expect(raw.chartBreakScore).toBe(8);
    expect(raw.disclosureRiskScore).toBe(5);
    expect(raw.overweightScore).toBe(3);
    expect(raw.timeExceededScore).toBe(4);
    expect(raw.positiveMomentumBonus).toBe(2);
    expect(raw.exitScore).toBe(45);
    expect(raw.exitAction).toBe('REDUCE');
    expect(raw.triggerType).toBe('THESIS_INVALIDATED');
    expect(raw.triggerTypes).toEqual(['STOP_LOSS', 'THESIS_INVALIDATED']);
    expect(raw.scoreDetail).toEqual({ note: '논리 훼손 + 손실 리스크 동반' });
    // AI 금지영역: Exit Score는 순수 Rule — aiUsed는 항상 false
    expect(raw.aiUsed).toBe(false);
  });

  it('findLatestByPositionId: 최신 신호의 exitScore/exitAction 왕복 일치', async () => {
    const latest = await withRollback(prisma, async (tx) => {
      const repo = new PrismaExitSignalRepository(tx as unknown as PrismaService);
      const positionId = await seedPosition(tx);
      await repo.save(buildParams(positionId));
      return repo.findLatestByPositionId(positionId);
    });

    expect(latest).not.toBeNull();
    expect(latest!.exitScore).toBe(45);
    expect(latest!.exitAction).toBe('REDUCE');
  });

  it('findLatestByPositionId: 신호 없는 positionId는 null', async () => {
    const latest = await withRollback(prisma, async (tx) => {
      const repo = new PrismaExitSignalRepository(tx as unknown as PrismaService);
      const positionId = await seedPosition(tx);
      return repo.findLatestByPositionId(positionId);
    });
    expect(latest).toBeNull();
  });

  it('격리 증명: 롤백 후 메인 커넥션에서 해당 positionId 신호 0', async () => {
    const positionId = await withRollback(prisma, async (tx) => {
      const repo = new PrismaExitSignalRepository(tx as unknown as PrismaService);
      const pid = await seedPosition(tx);
      await repo.save(buildParams(pid));
      return pid;
    });
    const leaked = await prisma.exitSignal.findMany({ where: { positionId } });
    expect(leaked).toHaveLength(0);
  });
});
