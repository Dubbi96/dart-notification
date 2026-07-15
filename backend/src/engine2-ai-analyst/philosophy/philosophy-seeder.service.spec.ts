/**
 * Persona 철학 엔진 P-A — 부팅 자동 시드 서비스 단위 테스트
 *
 * DB 불필요(단위). PrismaService 를 mock 하여 부팅 훅 동작을 검증한다:
 *  - count=0 → 4종 시드(upsert/createMany 호출)
 *  - count>0 → no-op(시드 호출 0)
 *  - 시드 중 예외 → onModuleInit 이 throw 하지 않음(graceful·부팅 무중단)
 *  - PHILOSOPHY_SEEDS 4종·philosophyId 집합 정합
 */
import { PhilosophySeederService } from './philosophy-seeder.service';
import { PHILOSOPHY_SEEDS } from './philosophy.seed-data';
import { PrismaService } from '../../prisma/prisma.service';

/** 트랜잭션 콜백에 넘길 tx 델리게이트 mock */
interface TxMock {
  investorPhilosophy: { upsert: jest.Mock };
  philosophyMetric: { deleteMany: jest.Mock; createMany: jest.Mock };
  philosophySource: { deleteMany: jest.Mock; createMany: jest.Mock };
}

type TxCallback = (tx: TxMock) => Promise<unknown>;

function makeTx(): TxMock {
  return {
    investorPhilosophy: { upsert: jest.fn().mockResolvedValue(undefined) },
    philosophyMetric: {
      deleteMany: jest.fn().mockResolvedValue(undefined),
      createMany: jest.fn().mockResolvedValue(undefined),
    },
    philosophySource: {
      deleteMany: jest.fn().mockResolvedValue(undefined),
      createMany: jest.fn().mockResolvedValue(undefined),
    },
  };
}

function makeService(
  count: jest.Mock,
  transaction: jest.Mock,
): PhilosophySeederService {
  const prismaMock = {
    investorPhilosophy: { count },
    $transaction: transaction,
  };
  return new PhilosophySeederService(prismaMock as unknown as PrismaService);
}

describe('PhilosophySeederService (부팅 자동 시드)', () => {
  it('count=0 이면 4종 철학을 시드한다(철학별 upsert + metrics/sources createMany)', async () => {
    const tx = makeTx();
    const count = jest.fn().mockResolvedValue(0);
    const transaction = jest
      .fn()
      .mockImplementation((cb: TxCallback) => cb(tx));

    const service = makeService(count, transaction);
    await service.onModuleInit();

    // 철학 4종 → 트랜잭션 4회, upsert 4회
    expect(transaction).toHaveBeenCalledTimes(PHILOSOPHY_SEEDS.length);
    expect(tx.investorPhilosophy.upsert).toHaveBeenCalledTimes(
      PHILOSOPHY_SEEDS.length,
    );
    expect(tx.philosophyMetric.deleteMany).toHaveBeenCalledTimes(
      PHILOSOPHY_SEEDS.length,
    );
    expect(tx.philosophyMetric.createMany).toHaveBeenCalledTimes(
      PHILOSOPHY_SEEDS.length,
    );
    expect(tx.philosophySource.createMany).toHaveBeenCalledTimes(
      PHILOSOPHY_SEEDS.length,
    );

    // upsert 가 4종 philosophyId 자연키로 호출됐다
    const upsertedIds = tx.investorPhilosophy.upsert.mock.calls
      .map((c) => (c[0] as { where: { philosophyId: string } }).where.philosophyId)
      .sort();
    expect(upsertedIds).toEqual([
      'BUFFETT',
      'DRUCKENMILLER',
      'GREENBLATT',
      'LYNCH',
    ]);
  });

  it('count>0 이면 no-op(트랜잭션·시드 호출 0 — 기존 데이터 무변경)', async () => {
    const count = jest.fn().mockResolvedValue(4);
    const transaction = jest.fn();

    const service = makeService(count, transaction);
    await service.onModuleInit();

    expect(count).toHaveBeenCalledTimes(1);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('시드 중 예외가 나도 onModuleInit 이 throw 하지 않는다(graceful·부팅 무중단)', async () => {
    const count = jest.fn().mockResolvedValue(0);
    const transaction = jest
      .fn()
      .mockRejectedValue(new Error('DB not ready (마이그레이션 전)'));

    const service = makeService(count, transaction);

    await expect(service.onModuleInit()).resolves.toBeUndefined();
  });

  it('count 조회 자체가 실패해도 throw 하지 않는다(DB 미준비 방어)', async () => {
    const count = jest.fn().mockRejectedValue(new Error('connection refused'));
    const transaction = jest.fn();

    const service = makeService(count, transaction);

    await expect(service.onModuleInit()).resolves.toBeUndefined();
    expect(transaction).not.toHaveBeenCalled();
  });

  it('PHILOSOPHY_SEEDS 는 정확히 4종·philosophyId 집합이 정합하다', () => {
    expect(PHILOSOPHY_SEEDS).toHaveLength(4);
    const ids = PHILOSOPHY_SEEDS.map((p) => p.philosophyId).sort();
    expect(ids).toEqual(['BUFFETT', 'DRUCKENMILLER', 'GREENBLATT', 'LYNCH']);
  });
});
