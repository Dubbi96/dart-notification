import { ExtractionStatus, ParseStatus } from '@prisma/client';
import { EventBackfillDrainService } from './event-backfill-drain.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DisclosureDocumentsService } from '../disclosure-documents/disclosure-documents.service';
import { DisclosureEventsService } from '../disclosure-events/disclosure-events.service';

/**
 * DAR-391 — 과거 공시 이벤트 추출 백필 드레이너 단위 검증.
 * Prisma/하위 서비스는 모킹(결정론). DART/DB 무접촉.
 */
describe('EventBackfillDrainService (DAR-391)', () => {
  function makeDeps() {
    const prisma = {
      disclosure: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
      $queryRaw: jest.fn(),
    } as unknown as PrismaService & {
      disclosure: { findMany: jest.Mock; count: jest.Mock };
      $queryRaw: jest.Mock;
    };

    const documentsService = {
      enqueueParsing: jest.fn().mockResolvedValue(undefined),
    } as unknown as DisclosureDocumentsService & { enqueueParsing: jest.Mock };

    const eventsService = {
      processDisclosure: jest.fn(),
    } as unknown as DisclosureEventsService & { processDisclosure: jest.Mock };

    const service = new EventBackfillDrainService(
      prisma,
      documentsService,
      eventsService,
    );
    return { prisma, documentsService, eventsService, service };
  }

  /** processDisclosure 가 주어진 status 를 반환하도록 한다. */
  const evResult = (extractionStatus: ExtractionStatus) =>
    ({ extractionStatus }) as Awaited<
      ReturnType<DisclosureEventsService['processDisclosure']>
    >;

  describe('drainOnce — Phase 1 추출(Rule)', () => {
    it('DONE 문서·이벤트 없는 백필 공시를 rcpDt 오름차순으로 추출하고 상태별로 집계한다', async () => {
      const { prisma, eventsService, service } = makeDeps();

      // Phase 1 후보(rcpDt asc), Phase 2 미파싱 후보
      prisma.disclosure.findMany
        .mockResolvedValueOnce([
          { rcpNo: 'A1' },
          { rcpNo: 'A2' },
          { rcpNo: 'A3' },
        ])
        .mockResolvedValueOnce([]);
      // 잔여 백로그 3건(미추출, 미파싱-missing, 미파싱-notDone)
      prisma.disclosure.count
        .mockResolvedValueOnce(5) // remainingUnextracted
        .mockResolvedValueOnce(2) // missing doc
        .mockResolvedValueOnce(3); // not-done doc

      eventsService.processDisclosure
        .mockResolvedValueOnce(evResult(ExtractionStatus.SUCCESS))
        .mockResolvedValueOnce(evResult(ExtractionStatus.NEEDS_REVIEW))
        .mockResolvedValueOnce(evResult(ExtractionStatus.FAILED));

      const r = await service.drainOnce();

      expect(r.extractScanned).toBe(3);
      expect(r.extractSuccess).toBe(1);
      expect(r.extractNeedsReview).toBe(1);
      expect(r.extractFailed).toBe(1);
      expect(r.remainingUnextracted).toBe(5);
      expect(r.remainingUnparsed).toBe(5); // 2 + 3

      // 각 후보에 대해 processDisclosure 호출(rcpDt 순서 보존).
      expect(eventsService.processDisclosure.mock.calls.map((c) => c[0])).toEqual([
        'A1',
        'A2',
        'A3',
      ]);

      // Phase 1 쿼리 술어: isBackfill·DONE 문서·이벤트 없음·rcpDt asc.
      const phase1Where = prisma.disclosure.findMany.mock.calls[0][0];
      expect(phase1Where.where).toEqual({
        isBackfill: true,
        document: { parseStatus: ParseStatus.DONE },
        disclosureEvent: { is: null },
      });
      expect(phase1Where.orderBy).toEqual([
        { rcpDt: 'asc' },
        { rcpNo: 'asc' },
      ]);
    });

    it('extractLimit=0 이면 Phase 1 을 건너뛴다(추출 0)', async () => {
      const { prisma, eventsService, service } = makeDeps();
      prisma.disclosure.findMany.mockResolvedValueOnce([]); // phase2 only
      prisma.disclosure.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      const r = await service.drainOnce({ extractLimit: 0 });

      expect(r.extractScanned).toBe(0);
      expect(eventsService.processDisclosure).not.toHaveBeenCalled();
    });

    it('extractLimit 을 하드 상한(500)으로 클램프해 take 에 전달한다', async () => {
      const { prisma, service } = makeDeps();
      prisma.disclosure.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      prisma.disclosure.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      await service.drainOnce({ extractLimit: 99999 });

      expect(prisma.disclosure.findMany.mock.calls[0][0].take).toBe(500);
    });
  });

  describe('drainOnce — Phase 2 파싱 등록(enqueue only)', () => {
    it('문서 없는 백필 공시를 rcpDt 오름차순으로 enqueueParsing 한다(fetch 없음)', async () => {
      const { prisma, documentsService, service } = makeDeps();
      prisma.disclosure.findMany
        .mockResolvedValueOnce([]) // phase1 none
        .mockResolvedValueOnce([{ rcpNo: 'B1' }, { rcpNo: 'B2' }]); // phase2
      prisma.disclosure.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(0);

      const r = await service.drainOnce();

      expect(r.parseEnqueued).toBe(2);
      expect(documentsService.enqueueParsing).toHaveBeenCalledWith(['B1', 'B2']);

      const phase2Where = prisma.disclosure.findMany.mock.calls[1][0];
      expect(phase2Where.where).toEqual({
        isBackfill: true,
        document: { is: null },
      });
      expect(phase2Where.orderBy).toEqual([
        { rcpDt: 'asc' },
        { rcpNo: 'asc' },
      ]);
    });

    it('미파싱 후보가 0건이면 enqueueParsing 을 호출하지 않는다', async () => {
      const { prisma, documentsService, service } = makeDeps();
      prisma.disclosure.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);
      prisma.disclosure.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      const r = await service.drainOnce();
      expect(r.parseEnqueued).toBe(0);
      expect(documentsService.enqueueParsing).not.toHaveBeenCalled();
    });

    it('parseEnqueueLimit=0 이면 Phase 2 를 건너뛴다(findMany 1회=Phase1 만)', async () => {
      const { prisma, documentsService, service } = makeDeps();
      prisma.disclosure.findMany.mockResolvedValueOnce([]); // phase1 only
      prisma.disclosure.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      await service.drainOnce({ parseEnqueueLimit: 0 });

      expect(prisma.disclosure.findMany).toHaveBeenCalledTimes(1);
      expect(documentsService.enqueueParsing).not.toHaveBeenCalled();
    });
  });

  describe('getCoverageReport — rcpDt 월별 분포', () => {
    it('원시 행을 number 로 정규화하고 coverageRatio·합계를 산출한다(bigint 허용)', async () => {
      const { prisma, service } = makeDeps();
      prisma.$queryRaw.mockResolvedValueOnce([
        { month: '202508', disclosures: 100n, events: 0n }, // 빈 구간
        { month: '202606', disclosures: 200, events: 150 },
      ]);

      const report = await service.getCoverageReport(
        new Date('2026-06-20T00:00:00.000Z'),
      );

      expect(report.generatedAt).toBe('2026-06-20T00:00:00.000Z');
      expect(report.totalDisclosures).toBe(300);
      expect(report.totalEvents).toBe(150);
      expect(report.months).toEqual([
        { rcpMonth: '202508', disclosures: 100, events: 0, coverageRatio: 0 },
        { rcpMonth: '202606', disclosures: 200, events: 150, coverageRatio: 0.75 },
      ]);
    });

    it('월 키가 6자리 미만(불량)인 행은 방어적으로 제외한다', async () => {
      const { prisma, service } = makeDeps();
      prisma.$queryRaw.mockResolvedValueOnce([
        { month: null, disclosures: 9, events: 9 },
        { month: '2025', disclosures: 7, events: 7 },
        { month: '202601', disclosures: 10, events: 4 },
      ]);

      const report = await service.getCoverageReport();
      expect(report.months).toEqual([
        { rcpMonth: '202601', disclosures: 10, events: 4, coverageRatio: 0.4 },
      ]);
      expect(report.totalDisclosures).toBe(10);
      expect(report.totalEvents).toBe(4);
    });
  });
});
