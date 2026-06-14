// backend/src/engine1-disclosure/insider-holdings/insider-holdings.service.spec.ts
// 배치 수집·멱등 upsert·DART 미설정 graceful 종료 스펙 (DAR-87).

import { InsiderHoldingsService } from './insider-holdings.service';
import { DartApiUnavailableError } from '../dart-api/dart-api.service';

function makeService(overrides: {
  prisma?: any;
  dartApi?: any;
} = {}) {
  const upsert = jest.fn().mockResolvedValue({});
  const prisma = {
    company: { findUnique: jest.fn().mockResolvedValue({ corpCode: 'C1' }) },
    insiderHoldingChange: { upsert },
    tradingSignal: { findMany: jest.fn().mockResolvedValue([]) },
    disclosureEvent: { findMany: jest.fn().mockResolvedValue([]) },
    watchList: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides.prisma,
  };
  const dartApi = {
    fetchMajorStockHoldings: jest.fn().mockResolvedValue({ status: '013', message: '', list: [] }),
    fetchExecutiveStockHoldings: jest.fn().mockResolvedValue({ status: '013', message: '', list: [] }),
    ...overrides.dartApi,
  };
  const service = new InsiderHoldingsService(prisma as any, dartApi as any);
  return { service, prisma, dartApi, upsert };
}

describe('InsiderHoldingsService', () => {
  describe('collectForCorpCode', () => {
    it('majorstock + elestock 행을 정규화·멱등 upsert', async () => {
      const { service, upsert } = makeService({
        dartApi: {
          fetchMajorStockHoldings: jest.fn().mockResolvedValue({
            status: '000',
            message: '',
            list: [
              {
                rcept_no: 'R1',
                rcept_dt: '20260607',
                corp_code: 'C1',
                repror: '국민연금',
                stkqy: '1,000',
                stkqy_irds: '100',
                stkrt: '6.0',
                stkrt_irds: '0.5',
              },
            ],
          }),
          fetchExecutiveStockHoldings: jest.fn().mockResolvedValue({
            status: '000',
            message: '',
            list: [
              {
                rcept_no: 'R2',
                rcept_dt: '20260607',
                corp_code: 'C1',
                repror: '대표이사',
                sp_stock_lmp_cnt: '500',
                sp_stock_lmp_irds_cnt: '-50',
              },
            ],
          }),
        },
      });

      const saved = await service.collectForCorpCode('C1');
      expect(saved).toBe(2);
      expect(upsert).toHaveBeenCalledTimes(2);
      // 멱등키 where 사용 검증
      const firstWhere = upsert.mock.calls[0][0].where;
      expect(firstWhere.source_rcptNo_reporter).toEqual({
        source: 'MAJOR_STOCK',
        rcptNo: 'R1',
        reporter: '국민연금',
      });
    });

    it('동일 멱등키 중복 행은 1건으로 dedup', async () => {
      const dup = {
        rcept_no: 'R1',
        corp_code: 'C1',
        repror: '동일인',
        stkqy_irds: '10',
      };
      const { service, upsert } = makeService({
        dartApi: {
          fetchMajorStockHoldings: jest.fn().mockResolvedValue({
            status: '000',
            message: '',
            list: [dup, { ...dup, stkqy_irds: '20' }],
          }),
        },
      });
      const saved = await service.collectForCorpCode('C1');
      expect(saved).toBe(1);
      expect(upsert).toHaveBeenCalledTimes(1);
    });

    it('미등록 회사(FK 미존재) 행은 적재하지 않음(고아 방지)', async () => {
      const { service, upsert } = makeService({
        prisma: { company: { findUnique: jest.fn().mockResolvedValue(null) } },
        dartApi: {
          fetchMajorStockHoldings: jest.fn().mockResolvedValue({
            status: '000',
            message: '',
            list: [{ rcept_no: 'R1', corp_code: 'CX', repror: 'x', stkqy_irds: '1' }],
          }),
        },
      });
      await service.collectForCorpCode('CX');
      expect(upsert).not.toHaveBeenCalled();
    });
  });

  describe('collectBatch', () => {
    it('대상 종목 없으면 SUCCESS/0', async () => {
      const { service } = makeService();
      const r = await service.collectBatch({ corpCodes: [] });
      expect(r.status).toBe('SUCCESS');
      expect(r.target).toBe(0);
    });

    it('DART 미설정(키 없음) → graceful FAILED 종료', async () => {
      const { service } = makeService({
        dartApi: {
          fetchMajorStockHoldings: jest
            .fn()
            .mockRejectedValue(new DartApiUnavailableError('no key')),
          fetchExecutiveStockHoldings: jest.fn().mockResolvedValue({ status: '013', list: [] }),
        },
      });
      const r = await service.collectBatch({ corpCodes: ['C1'], rateLimitMs: 0 });
      expect(r.status).toBe('FAILED');
      expect(r.message).toBe('DART API 미설정');
    });

    it('일반 오류 종목은 failed 집계 후 계속 진행(PARTIAL)', async () => {
      const calls: string[] = [];
      const { service } = makeService({
        dartApi: {
          fetchMajorStockHoldings: jest.fn().mockImplementation((c: string) => {
            calls.push(c);
            if (c === 'C1') return Promise.reject(new Error('timeout'));
            return Promise.resolve({ status: '013', list: [] });
          }),
          fetchExecutiveStockHoldings: jest.fn().mockResolvedValue({ status: '013', list: [] }),
        },
      });
      const r = await service.collectBatch({ corpCodes: ['C1', 'C2'], rateLimitMs: 0 });
      expect(r.status).toBe('PARTIAL');
      expect(r.failed).toBe(1);
      expect(calls).toContain('C2'); // 오류 후에도 다음 종목 진행
    });
  });

  describe('selectPriorityCorpCodes', () => {
    it('신호→이벤트→관심종목 dedup 누적', async () => {
      const { service } = makeService({
        prisma: {
          tradingSignal: { findMany: jest.fn().mockResolvedValue([{ corpCode: 'A' }]) },
          disclosureEvent: { findMany: jest.fn().mockResolvedValue([{ corpCode: 'A' }, { corpCode: 'B' }]) },
          watchList: { findMany: jest.fn().mockResolvedValue([{ corpCode: 'C' }]) },
        },
      });
      const codes = await service.selectPriorityCorpCodes();
      expect(new Set(codes)).toEqual(new Set(['A', 'B', 'C']));
    });
  });

  // ─── DAR-88: read 전용 조회 ────────────────────────────────────────
  describe('findChanges (read-only)', () => {
    function makeReadService(rows: any[], total: number) {
      const findMany = jest.fn().mockResolvedValue(rows);
      const count = jest.fn().mockResolvedValue(total);
      const prisma = { insiderHoldingChange: { findMany, count } };
      const service = new InsiderHoldingsService(prisma as any, {} as any);
      return { service, findMany, count };
    }

    const sampleRow = {
      id: 'i1',
      source: 'EXECUTIVE',
      rcptNo: 'R1',
      corpCode: 'C1',
      reporter: '대표이사',
      relation: '대표이사',
      isExecutive: true,
      isRegistered: true,
      isMajorShareholder: true,
      sharesAfter: 1000n,
      sharesChange: -50n,
      ratioAfter: 6.0,
      ratioChange: -0.3,
      tradeType: 'SELL',
      unitPrice: null,
      reportReason: null,
      reportedAt: new Date('2026-06-01T00:00:00.000Z'),
    };

    it('corpCode·방향·출처·기간 필터를 where 절로 전달하고 페이지네이션', async () => {
      const { service, findMany, count } = makeReadService([sampleRow], 1);
      const res = await service.findChanges({
        corpCode: 'C1',
        tradeType: 'SELL',
        source: 'EXECUTIVE',
        from: '20260101',
        to: '20260601',
        page: 2,
        limit: 10,
      });
      const arg = findMany.mock.calls[0][0];
      expect(arg.where.corpCode).toBe('C1');
      expect(arg.where.tradeType).toBe('SELL');
      expect(arg.where.source).toBe('EXECUTIVE');
      expect(arg.where.reportedAt.gte).toEqual(new Date(Date.UTC(2026, 0, 1)));
      // 종료일은 해당 일자 전체 포함(다음날 0시 미만)
      expect(arg.where.reportedAt.lt).toEqual(
        new Date(Date.UTC(2026, 5, 2)),
      );
      expect(arg.skip).toBe(10); // (page2-1)*limit10
      expect(arg.take).toBe(10);
      expect(count).toHaveBeenCalledWith({ where: arg.where });
      expect(res.meta).toEqual({ page: 2, limit: 10, total: 1, totalPages: 1 });
    });

    it('BigInt(sharesAfter/sharesChange) → number 직렬화 안전 변환', async () => {
      const { service } = makeReadService([sampleRow], 1);
      const res = await service.findChanges({ corpCode: 'C1' });
      expect(res.items[0].sharesAfter).toBe(1000);
      expect(res.items[0].sharesChange).toBe(-50);
      expect(typeof res.items[0].sharesAfter).toBe('number');
    });

    it('필터·기간 없으면 where 비우고 기본 페이지/limit 적용', async () => {
      const { service, findMany } = makeReadService([], 0);
      const res = await service.findChanges();
      const arg = findMany.mock.calls[0][0];
      expect(arg.where).toEqual({});
      expect(arg.skip).toBe(0);
      expect(arg.take).toBe(20);
      expect(res.items).toEqual([]);
      expect(res.meta).toEqual({ page: 1, limit: 20, total: 0, totalPages: 0 });
    });

    it('meta.totalPages = ceil(total/limit) — 형제 엔드포인트(disclosures·signals)와 응답 계약 일치', async () => {
      // total 25, limit 10 → 3페이지(ceil)
      const { service } = makeReadService([sampleRow], 25);
      const res = await service.findChanges({ limit: 10 });
      expect(res.meta).toEqual({
        page: 1,
        limit: 10,
        total: 25,
        totalPages: 3,
      });
    });

    it('total=0 → totalPages=0 (disclosures.service 빈결과 패턴)', async () => {
      const { service } = makeReadService([], 0);
      const res = await service.findChanges({ limit: 10 });
      expect(res.meta.total).toBe(0);
      expect(res.meta.totalPages).toBe(0);
    });
  });
});
