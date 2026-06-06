// backend/src/engine1-disclosure/disclosure-documents/facts/dart-filed-fact.service.spec.ts
// DAR-95: 영속 계층 단위 테스트 (멱등 replace·결측 skip·backfill·조회)

import { ParseStatus } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { ParsedJson } from '../types/parsed-json.type';
import { DartFiledFactService } from './dart-filed-fact.service';

describe('DartFiledFactService', () => {
  let service: DartFiledFactService;
  let prisma: {
    dartFiledFact: {
      deleteMany: jest.Mock;
      createMany: jest.Mock;
      findMany: jest.Mock;
    };
    disclosureDocument: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      dartFiledFact: {
        deleteMany: jest.fn().mockReturnValue({ __op: 'deleteMany' }),
        createMany: jest.fn().mockReturnValue({ __op: 'createMany' }),
        findMany: jest.fn(),
      },
      disclosureDocument: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
      },
      // 배열형 $transaction: 빌더 배열을 받아 모두 resolve
      $transaction: jest.fn((ops: unknown[]) => Promise.resolve(ops)),
    };
    service = new DartFiledFactService(prisma as unknown as PrismaService);
  });

  const contractJson: ParsedJson = {
    docType: 'SUPPLY_CONTRACT',
    rawTableCount: 1,
    keyValueSource: 'table_0',
    contractAmount: 100_000_000,
    counterparty: 'A사',
  };

  describe('persistFromParsedJson', () => {
    it('rcpNo 단위 deleteMany + createMany를 단일 트랜잭션으로 수행한다(원자적 replace)', async () => {
      const n = await service.persistFromParsedJson('R1', 'C1', contractJson);

      expect(n).toBe(2);
      expect(prisma.dartFiledFact.deleteMany).toHaveBeenCalledWith({
        where: { rcpNo: 'R1' },
      });
      const rows = prisma.dartFiledFact.createMany.mock.calls[0][0].data;
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        rcpNo: 'R1',
        corpCode: 'C1',
        docType: 'SUPPLY_CONTRACT',
      });
      // 트랜잭션에 두 빌더가 함께 전달됨
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(2);
    });

    it('정규화 결과 0건이면 createMany 없이 deleteMany만 수행(잔재 정리)', async () => {
      const n = await service.persistFromParsedJson('R1', 'C1', {
        docType: 'UNKNOWN',
        rawTableCount: 0,
        keyValueSource: 'none',
      });
      expect(n).toBe(0);
      expect(prisma.dartFiledFact.deleteMany).toHaveBeenCalledTimes(1);
      expect(prisma.dartFiledFact.createMany).not.toHaveBeenCalled();
      expect(prisma.$transaction.mock.calls[0][0]).toHaveLength(1);
    });

    it('멱등: 동일 입력 재적재 시 항상 replace로 동일 row 세트', async () => {
      await service.persistFromParsedJson('R1', 'C1', contractJson);
      await service.persistFromParsedJson('R1', 'C1', contractJson);
      const rows1 = prisma.dartFiledFact.createMany.mock.calls[0][0].data;
      const rows2 = prisma.dartFiledFact.createMany.mock.calls[1][0].data;
      expect(rows2).toEqual(rows1);
      // 매 호출마다 deleteMany 선행(중복 누적 방지)
      expect(prisma.dartFiledFact.deleteMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('persistForRcpNo', () => {
    it('DONE + parsedJson 있으면 적재한다', async () => {
      prisma.disclosureDocument.findUnique.mockResolvedValue({
        rcpNo: 'R1',
        corpCode: 'C1',
        parseStatus: ParseStatus.DONE,
        parsedJson: contractJson,
      });
      const n = await service.persistForRcpNo('R1');
      expect(n).toBe(2);
      expect(prisma.dartFiledFact.createMany).toHaveBeenCalled();
    });

    it('문서 미존재면 graceful skip(0)', async () => {
      prisma.disclosureDocument.findUnique.mockResolvedValue(null);
      expect(await service.persistForRcpNo('R9')).toBe(0);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('DONE이 아니거나 parsedJson 결측이면 skip(0)', async () => {
      prisma.disclosureDocument.findUnique.mockResolvedValue({
        rcpNo: 'R1',
        corpCode: 'C1',
        parseStatus: ParseStatus.PARSING,
        parsedJson: contractJson,
      });
      expect(await service.persistForRcpNo('R1')).toBe(0);

      prisma.disclosureDocument.findUnique.mockResolvedValue({
        rcpNo: 'R2',
        corpCode: 'C1',
        parseStatus: ParseStatus.DONE,
        parsedJson: null,
      });
      expect(await service.persistForRcpNo('R2')).toBe(0);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('backfill', () => {
    it('DONE 문서들을 순회 적재하고 합계를 반환한다', async () => {
      prisma.disclosureDocument.findMany.mockResolvedValue([
        { rcpNo: 'R1', corpCode: 'C1', parsedJson: contractJson },
        { rcpNo: 'R2', corpCode: 'C2', parsedJson: contractJson },
      ]);
      const res = await service.backfill(50);
      expect(res).toEqual({ processed: 2, facts: 4 });
      expect(prisma.dartFiledFact.createMany).toHaveBeenCalledTimes(2);
    });

    it('limit은 1~1000으로 clamp된다', async () => {
      prisma.disclosureDocument.findMany.mockResolvedValue([]);
      await service.backfill(99999);
      expect(prisma.disclosureDocument.findMany.mock.calls[0][0].take).toBe(
        1000,
      );
      await service.backfill(0);
      expect(prisma.disclosureDocument.findMany.mock.calls[1][0].take).toBe(1);
    });
  });

  describe('findByRcpNo', () => {
    it('factKey 정렬로 조회한다', async () => {
      prisma.dartFiledFact.findMany.mockResolvedValue([]);
      await service.findByRcpNo('R1');
      expect(prisma.dartFiledFact.findMany).toHaveBeenCalledWith({
        where: { rcpNo: 'R1' },
        orderBy: { factKey: 'asc' },
      });
    });
  });
});
