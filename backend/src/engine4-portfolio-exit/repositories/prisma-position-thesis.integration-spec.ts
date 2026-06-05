/**
 * prisma-position-thesis.integration-spec.ts — 실 Postgres 통합테스트 (DAR-38)
 *
 * PrismaPositionThesisRepository를 **실 dev DB**로 save→find 왕복 검증한다.
 * 단위테스트(prisma-repositories.spec.ts)는 mock만 돌아 실제 Prisma 쿼리(필드명·관계·
 * Json 직렬화)가 한 번도 실DB에서 검증된 적 없으므로 이를 보강한다.
 *
 * ★ 격리: 모든 테스트는 withRollback 트랜잭션 안에서 수행 후 롤백 → 잔여 row 0.
 *   FK 부모(Company→Disclosure→TradingSignal)도 트랜잭션 내 생성 후 함께 롤백된다.
 *
 * 실행: npm run test:integration (DB 가동 전제). 기본 npm test(단위)에서는 제외됨.
 */

import { PrismaPositionThesisRepository } from './prisma-position-thesis.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { withRollback } from '../../../test/integration/with-rollback';
import type { PositionThesisRecord } from '../domain/position-thesis.types';

const prisma = new PrismaService();

// 테스트 전용 자연키 — 실 데모 데이터(8자리 corpCode)와 절대 충돌하지 않는 prefix
const TAG = 'DAR38_PT';

/** FK 부모 체인(Company→Disclosure→TradingSignal) 생성 후 thesis 도메인 레코드 빌드 */
async function seedAndBuildThesis(
  tx: any,
  overrides: Partial<PositionThesisRecord> = {},
): Promise<PositionThesisRecord> {
  const corpCode = `${TAG}_CORP`;
  const rcpNo = `${TAG}_RCP0001`;
  const signalId = `${TAG}_SIG0001`;

  await tx.company.create({
    data: { corpCode, corpName: '통합테스트사', stockCode: '999999', market: 'KOSPI' },
  });
  await tx.disclosure.create({
    data: {
      rcpNo,
      corpCode,
      corpName: '통합테스트사',
      reportName: '단일판매ㆍ공급계약체결',
      rcpDt: '20260101',
      flrName: '통합테스트사',
      rmk: '',
      disclosureType: '주요사항보고',
    },
  });
  await tx.tradingSignal.create({
    data: {
      id: signalId,
      rcpNo,
      corpCode,
      stockCode: '999999',
      eventType: 'SUPPLY_CONTRACT',
      persona: 'GROWTH',
      buyScore: 72,
      signal: 'BUY_CANDIDATE',
      scoreBreakdown: { disclosureEvent: 30, keyMetric: 20, personaFit: 22 },
      riskPenalty: 0,
    },
  });

  return {
    id: `${TAG}_THESIS0001`,
    tradingSignalId: signalId,
    rcpNo,
    corpCode,
    entryReason: '공급계약 매출비중 20% 이상 — 성장 모멘텀',
    initialThesis: ['매출비중 22% 신규계약', 'RSI 회복 구간'],
    invalidConditions: [
      { type: 'PRICE_BELOW', value: 45000 },
      { type: 'STOP_LOSS_PCT', value: 8 },
    ],
    exitRules: [
      { type: 'STOP_LOSS_PCT', value: 8 },
      { type: 'MAX_HOLD_DAYS', value: 20 },
    ],
    maxWeight: 5.0,
    status: 'ACTIVE',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('PrismaPositionThesisRepository (실 Postgres 통합)', () => {
  let baselineCount: number;

  beforeAll(async () => {
    await prisma.$connect();
    baselineCount = await prisma.positionThesis.count();
  });

  afterAll(async () => {
    // 격리 검증: 모든 테스트 롤백 후 시작 시점과 row 수 동일(잔여 0)
    const finalCount = await prisma.positionThesis.count();
    expect(finalCount).toBe(baselineCount);
    await prisma.$disconnect();
  });

  it('save → findById 왕복: 모든 필드·Json 배열이 1:1 일치', async () => {
    const found = await withRollback(prisma, async (tx) => {
      const repo = new PrismaPositionThesisRepository(tx as unknown as PrismaService);
      const domain = await seedAndBuildThesis(tx);
      await repo.save(domain);
      return repo.findById(domain.id);
    });

    expect(found).not.toBeNull();
    expect(found!.id).toBe(`${TAG}_THESIS0001`);
    expect(found!.tradingSignalId).toBe(`${TAG}_SIG0001`);
    expect(found!.rcpNo).toBe(`${TAG}_RCP0001`);
    expect(found!.corpCode).toBe(`${TAG}_CORP`);
    expect(found!.entryReason).toBe('공급계약 매출비중 20% 이상 — 성장 모멘텀');
    // Json 컬럼 역직렬화 — 구조·순서 보존
    expect(found!.initialThesis).toEqual(['매출비중 22% 신규계약', 'RSI 회복 구간']);
    expect(found!.invalidConditions).toEqual([
      { type: 'PRICE_BELOW', value: 45000 },
      { type: 'STOP_LOSS_PCT', value: 8 },
    ]);
    expect(found!.exitRules).toEqual([
      { type: 'STOP_LOSS_PCT', value: 8 },
      { type: 'MAX_HOLD_DAYS', value: 20 },
    ]);
    expect(found!.maxWeight).toBe(5.0);
    expect(found!.status).toBe('ACTIVE');
  });

  it('findBySignalId / findByCorpCode: UNIQUE·인덱스 조회 경로가 실DB에서 동작', async () => {
    const { bySignal, byCorp } = await withRollback(prisma, async (tx) => {
      const repo = new PrismaPositionThesisRepository(tx as unknown as PrismaService);
      const domain = await seedAndBuildThesis(tx);
      await repo.save(domain);
      return {
        bySignal: await repo.findBySignalId(domain.tradingSignalId),
        byCorp: await repo.findByCorpCode(domain.corpCode),
      };
    });

    expect(bySignal).not.toBeNull();
    expect(bySignal!.id).toBe(`${TAG}_THESIS0001`);
    expect(byCorp.map((t) => t.id)).toContain(`${TAG}_THESIS0001`);
  });

  it('updateStatus → findByStatus: 상태전이 후 enum 조회 일치', async () => {
    const { updated, byStatus } = await withRollback(prisma, async (tx) => {
      const repo = new PrismaPositionThesisRepository(tx as unknown as PrismaService);
      const domain = await seedAndBuildThesis(tx);
      await repo.save(domain);
      const updated = await repo.updateStatus(domain.id, 'INVALIDATED');
      const byStatus = await repo.findByStatus('INVALIDATED');
      return { updated, byStatus };
    });

    expect(updated.status).toBe('INVALIDATED');
    expect(byStatus.map((t) => t.id)).toContain(`${TAG}_THESIS0001`);
  });

  it('격리 증명: 롤백 후 영구 커넥션에서 해당 id 조회 시 null (커밋 0)', async () => {
    const savedId = await withRollback(prisma, async (tx) => {
      const repo = new PrismaPositionThesisRepository(tx as unknown as PrismaService);
      const domain = await seedAndBuildThesis(tx);
      await repo.save(domain);
      return domain.id;
    });

    // 롤백 후 — 메인 커넥션엔 흔적 0
    const leaked = await prisma.positionThesis.findUnique({ where: { id: savedId } });
    expect(leaked).toBeNull();
  });
});
