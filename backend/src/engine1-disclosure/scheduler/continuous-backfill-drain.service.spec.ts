// backend/src/engine1-disclosure/scheduler/continuous-backfill-drain.service.spec.ts
// DAR-396: 연속 과거 확장 백필 드레이너 — 프런티어 전진, 쿼터 인지 중단, 멱등, 하한 종료, 커버리지.

import { Test, TestingModule } from '@nestjs/testing';
import {
  ContinuousBackfillDrainService,
  BACKFILL_EXTEND_TRIGGER,
  DART_EARLIEST_RCP_DT,
} from './continuous-backfill-drain.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DartApiService } from '../dart-api/dart-api.service';
import { DisclosureDocumentsService } from '../disclosure-documents/disclosure-documents.service';

/** DART list 아이템 팩토리. */
function item(rcptNo: string, rcptDt: string) {
  return {
    rcept_no: rcptNo,
    corp_code: '00126380',
    corp_name: '삼성전자',
    stock_code: '005930',
    corp_cls: 'Y',
    report_nm: '주요사항보고서(유상증자결정)',
    flr_nm: '삼성전자',
    rcept_dt: rcptDt,
    rm: '',
  };
}

describe('ContinuousBackfillDrainService (DAR-396)', () => {
  let service: ContinuousBackfillDrainService;
  let prisma: {
    disclosure: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      createMany: jest.Mock;
      count: jest.Mock;
    };
    disclosureCollectionLog: { findFirst: jest.Mock; create: jest.Mock };
  };
  let dart: {
    getAllDisclosuresWithMeta: jest.Mock;
    classifyDisclosureType: jest.Mock;
  };
  let documents: { enqueueParsing: jest.Mock };

  beforeEach(async () => {
    prisma = {
      disclosure: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]), // dedup: 기존 없음
        createMany: jest.fn(),
        count: jest.fn().mockResolvedValue(0),
      },
      disclosureCollectionLog: {
        findFirst: jest.fn().mockResolvedValue(null), // BACKFILL_EXTEND SUCCESS 로그 없음
        create: jest.fn().mockResolvedValue({ id: 1 }),
      },
    };
    dart = {
      getAllDisclosuresWithMeta: jest.fn(),
      classifyDisclosureType: jest.fn().mockReturnValue('MATERIAL'),
    };
    documents = { enqueueParsing: jest.fn().mockResolvedValue(undefined) };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ContinuousBackfillDrainService,
        { provide: PrismaService, useValue: prisma },
        { provide: DartApiService, useValue: dart },
        { provide: DisclosureDocumentsService, useValue: documents },
      ],
    }).compile();

    service = moduleRef.get(ContinuousBackfillDrainService);
  });

  it('앵커(공시 최소 rcpDt) 직전부터 과거로 청크 수집·신규 저장·파싱 등록한다', async () => {
    // 앵커 = 20250619 → 첫 윈도 endDe=20250618, startDe=20250520(30일)
    prisma.disclosure.findFirst.mockResolvedValue({ rcpDt: '20250619' });
    dart.getAllDisclosuresWithMeta.mockResolvedValue({
      items: [item('20250610000001', '20250610'), item('20250605000002', '20250605')],
      quotaExceeded: false,
      abnormalStatus: null,
    });
    prisma.disclosure.createMany.mockResolvedValue({ count: 2 });

    const result = await service.drainOnce({ maxChunks: 1 });

    expect(result.chunksProcessed).toBe(1);
    expect(result.savedTotal).toBe(2);
    expect(result.fetchedTotal).toBe(2);
    expect(result.quotaExceeded).toBe(false);
    expect(result.reachedEarliest).toBe(false);
    expect(result.frontierAtStart).toBe('20250619');

    // 윈도 경계: endDe=앵커 하루 전
    const [bgnDe, endDe] = dart.getAllDisclosuresWithMeta.mock.calls[0];
    expect(endDe).toBe('20250618');
    expect(bgnDe).toBe('20250520');

    // 저장: isBackfill=true 표식
    const createArg = prisma.disclosure.createMany.mock.calls[0][0];
    expect(createArg.data.every((d: { isBackfill: boolean }) => d.isBackfill === true)).toBe(true);
    expect(createArg.skipDuplicates).toBe(true);

    // 파싱 큐 등록(체이닝)
    expect(documents.enqueueParsing).toHaveBeenCalledWith([
      '20250610000001',
      '20250605000002',
    ]);

    // 완주(SUCCESS) 로그 — 프런티어 추적
    const logArg = prisma.disclosureCollectionLog.create.mock.calls[0][0];
    expect(logArg.data.triggeredBy).toBe(BACKFILL_EXTEND_TRIGGER);
    expect(logArg.data.status).toBe('SUCCESS');
    expect(logArg.data.bgnDe).toBe('20250520');
  });

  it('쿼터 소진 감지 시 그 윈도는 PARTIAL 로 남기고 즉시 중단(throw 없음)', async () => {
    prisma.disclosure.findFirst.mockResolvedValue({ rcpDt: '20250619' });
    dart.getAllDisclosuresWithMeta.mockResolvedValue({
      items: [item('20250610000001', '20250610')], // 쿼터로 일부만
      quotaExceeded: true,
      abnormalStatus: null,
    });
    prisma.disclosure.createMany.mockResolvedValue({ count: 1 });

    const result = await service.drainOnce({ maxChunks: 6 });

    // maxChunks=6 이어도 쿼터로 1청크 후 중단
    expect(dart.getAllDisclosuresWithMeta).toHaveBeenCalledTimes(1);
    expect(result.chunksProcessed).toBe(1);
    expect(result.quotaExceeded).toBe(true);
    expect(result.savedTotal).toBe(1); // 받은 일부는 멱등 저장(진행 보존)

    // PARTIAL 로그 — 프런티어 미advance(다음 리셋에 재시도)
    const logArg = prisma.disclosureCollectionLog.create.mock.calls[0][0];
    expect(logArg.data.status).toBe('PARTIAL');
  });

  it('프런티어는 SUCCESS 로그의 최소 bgnDe 를 우선 사용한다(빈 윈도도 과거로 전진)', async () => {
    // SUCCESS 로그 bgnDe=20250101 존재 → 앵커(공시 최소 20250619)보다 과거이므로 프런티어=20250101
    prisma.disclosureCollectionLog.findFirst.mockResolvedValue({ bgnDe: '20250101' });
    prisma.disclosure.findFirst.mockResolvedValue({ rcpDt: '20250619' });
    // 빈 윈도(0건)지만 완주 → SUCCESS, 프런티어 전진
    dart.getAllDisclosuresWithMeta.mockResolvedValue({
      items: [],
      quotaExceeded: false,
      abnormalStatus: null,
    });

    const result = await service.drainOnce({ maxChunks: 1 });

    const [bgnDe, endDe] = dart.getAllDisclosuresWithMeta.mock.calls[0];
    expect(endDe).toBe('20241231'); // 20250101 하루 전
    expect(bgnDe).toBe('20241202'); // 30일 윈도
    expect(result.savedTotal).toBe(0);
    // 빈 윈도도 SUCCESS 기록 → 다음 회차 프런티어가 더 내려감
    const logArg = prisma.disclosureCollectionLog.create.mock.calls[0][0];
    expect(logArg.data.status).toBe('SUCCESS');
    expect(logArg.data.newCount).toBe(0);
    // createMany 는 0건이면 호출 안 함
    expect(prisma.disclosure.createMany).not.toHaveBeenCalled();
  });

  it('하한(DART_EARLIEST_RCP_DT) 도달 시 reachedEarliest=true, DART 호출 없음', async () => {
    // 프런티어가 하한 = 19990101 → endDe=19981231 < 하한 → 종료
    prisma.disclosureCollectionLog.findFirst.mockResolvedValue({
      bgnDe: DART_EARLIEST_RCP_DT,
    });
    prisma.disclosure.findFirst.mockResolvedValue({ rcpDt: DART_EARLIEST_RCP_DT });

    const result = await service.drainOnce({ maxChunks: 6 });

    expect(result.reachedEarliest).toBe(true);
    expect(result.chunksProcessed).toBe(0);
    expect(dart.getAllDisclosuresWithMeta).not.toHaveBeenCalled();
  });

  it('이미 적재된 rcpNo 는 파싱 등록 대상에서 제외(멱등 재개)', async () => {
    prisma.disclosure.findFirst.mockResolvedValue({ rcpDt: '20250619' });
    dart.getAllDisclosuresWithMeta.mockResolvedValue({
      items: [item('AAA', '20250610'), item('BBB', '20250605')],
      quotaExceeded: false,
      abnormalStatus: null,
    });
    // AAA 는 이미 존재 → BBB 만 신규
    prisma.disclosure.findMany.mockResolvedValue([{ rcpNo: 'AAA' }]);
    prisma.disclosure.createMany.mockResolvedValue({ count: 1 });

    const result = await service.drainOnce({ maxChunks: 1 });

    expect(result.savedTotal).toBe(1);
    expect(documents.enqueueParsing).toHaveBeenCalledWith(['BBB']);
    const createArg = prisma.disclosure.createMany.mock.calls[0][0];
    expect(createArg.data.map((d: { rcpNo: string }) => d.rcpNo)).toEqual(['BBB']);
  });

  it('여러 청크를 연속 진행하며 프런티어가 청크마다 과거로 내려간다', async () => {
    // 로그는 없고 앵커만; 매 청크 후 resolveFrontier 가 다시 호출되므로 findFirst 를 순차 반환
    prisma.disclosureCollectionLog.findFirst.mockResolvedValue(null);
    prisma.disclosure.findFirst
      // frontierAtStart
      .mockResolvedValueOnce({ rcpDt: '20250301' })
      // chunk1 frontier
      .mockResolvedValueOnce({ rcpDt: '20250301' })
      // chunk2 frontier (저장으로 최소 rcpDt 가 더 과거가 됨)
      .mockResolvedValueOnce({ rcpDt: '20250115' });
    dart.getAllDisclosuresWithMeta
      .mockResolvedValueOnce({
        items: [item('A', '20250115')],
        quotaExceeded: false,
        abnormalStatus: null,
      })
      .mockResolvedValueOnce({
        items: [item('B', '20241220')],
        quotaExceeded: false,
        abnormalStatus: null,
      });
    prisma.disclosure.createMany.mockResolvedValue({ count: 1 });

    const result = await service.drainOnce({ maxChunks: 2 });

    expect(result.chunksProcessed).toBe(2);
    const endDe1 = dart.getAllDisclosuresWithMeta.mock.calls[0][1];
    const endDe2 = dart.getAllDisclosuresWithMeta.mock.calls[1][1];
    expect(endDe1).toBe('20250228'); // 20250301 하루 전
    expect(endDe2).toBe('20250114'); // 20250115 하루 전 (더 과거)
  });

  it('documentsService 미주입(@Optional)이어도 수집·저장은 정상 동작', async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        ContinuousBackfillDrainService,
        { provide: PrismaService, useValue: prisma },
        { provide: DartApiService, useValue: dart },
      ],
    }).compile();
    const svc = moduleRef.get(ContinuousBackfillDrainService);

    prisma.disclosure.findFirst.mockResolvedValue({ rcpDt: '20250619' });
    dart.getAllDisclosuresWithMeta.mockResolvedValue({
      items: [item('X', '20250610')],
      quotaExceeded: false,
      abnormalStatus: null,
    });
    prisma.disclosure.createMany.mockResolvedValue({ count: 1 });

    const result = await svc.drainOnce({ maxChunks: 1 });
    expect(result.savedTotal).toBe(1);
  });

  describe('getCoverageReport', () => {
    it('최소·최대 rcpDt·총건수·프런티어·하한도달을 보고한다', async () => {
      prisma.disclosure.findFirst
        .mockResolvedValueOnce({ rcpDt: '20230101' }) // earliest
        .mockResolvedValueOnce({ rcpDt: '20260619' }) // latest
        .mockResolvedValueOnce({ rcpDt: '20230101' }); // resolveFrontier 의 disclosure findFirst
      prisma.disclosure.count
        .mockResolvedValueOnce(500000) // total
        .mockResolvedValueOnce(450000); // backfill
      prisma.disclosureCollectionLog.findFirst.mockResolvedValue({ bgnDe: '20230101' });

      const report = await service.getCoverageReport(new Date('2026-06-20T00:00:00Z'));

      expect(report.earliestRcpDt).toBe('20230101');
      expect(report.latestRcpDt).toBe('20260619');
      expect(report.totalDisclosures).toBe(500000);
      expect(report.backfillDisclosures).toBe(450000);
      expect(report.frontier).toBe('20230101');
      expect(report.reachedEarliest).toBe(false);
      expect(report.earliestTargetRcpDt).toBe(DART_EARLIEST_RCP_DT);
    });
  });
});
