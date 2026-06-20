import { ExtractionStatus, ParseStatus } from '@prisma/client';
import { PipelineIntegrityService } from './pipeline-integrity.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DisclosureDocumentsService } from '../disclosure-documents/disclosure-documents.service';
import { DisclosureEventsService } from '../disclosure-events/disclosure-events.service';
import { JOB } from '../../common/queues/queue.constants';

/**
 * DAR-126 — 수집→파싱→이벤트→AI 폐루프 견고화.
 * 집계(read-only) 정합 + 누락 backfill 순서·멱등 + AI 재발행 페이로드 검증.
 */
describe('PipelineIntegrityService (DAR-126)', () => {
  const NOW = new Date('2026-06-08T12:00:00.000Z');

  function makePrisma(over: Record<string, unknown> = {}) {
    return {
      disclosure: {
        count: jest.fn().mockResolvedValue(0),
        findMany: jest.fn().mockResolvedValue([]),
      },
      disclosureDocument: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      disclosureEvent: {
        groupBy: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      disclosureAnalysis: {
        count: jest.fn().mockResolvedValue(0),
      },
      ...over,
    } as unknown as PrismaService;
  }

  function makeDocs(over: Partial<DisclosureDocumentsService> = {}) {
    return {
      enqueueParsing: jest.fn().mockResolvedValue(undefined),
      processPendingBatch: jest
        .fn()
        .mockResolvedValue({ success: 0, failed: 0, durationMs: 0 }),
      ...over,
    } as unknown as DisclosureDocumentsService;
  }

  function makeEvents(over: Partial<DisclosureEventsService> = {}) {
    return {
      processPendingDisclosures: jest
        .fn()
        .mockResolvedValue({ success: 0, failed: 0, needsReview: 0, durationMs: 0 }),
      ...over,
    } as unknown as DisclosureEventsService;
  }

  // ─── 관측(getHealth) ───────────────────────────────────────────────────────

  it('단계별 건수·지연을 read-only 로 집계한다', async () => {
    const prisma = makePrisma();
    // disclosure.count: [total, last24h, missingDocument]
    (prisma.disclosure.count as jest.Mock)
      .mockResolvedValueOnce(100) // total
      .mockResolvedValueOnce(12) // last24h
      .mockResolvedValueOnce(3); // missingDocument
    (prisma.disclosureDocument.groupBy as jest.Mock).mockResolvedValue([
      { parseStatus: ParseStatus.DONE, _count: { _all: 80 } },
      { parseStatus: ParseStatus.PENDING, _count: { _all: 5 } },
      { parseStatus: ParseStatus.PARSE_FAILED, _count: { _all: 2 } },
    ]);
    // disclosureDocument.count: [retryable, countParsedDocsWithoutEvent]
    (prisma.disclosureDocument.count as jest.Mock)
      .mockResolvedValueOnce(2) // retryable
      .mockResolvedValueOnce(4); // missingForParsedDocs
    // oldest pending doc: 90분 전
    (prisma.disclosureDocument.findFirst as jest.Mock).mockResolvedValue({
      createdAt: new Date(NOW.getTime() - 90 * 60 * 1000),
    });
    (prisma.disclosureEvent.groupBy as jest.Mock).mockResolvedValue([
      { extractionStatus: ExtractionStatus.SUCCESS, _count: { _all: 60 } },
      { extractionStatus: ExtractionStatus.NEEDS_REVIEW, _count: { _all: 10 } },
      { extractionStatus: ExtractionStatus.PENDING, _count: { _all: 1 } },
    ]);
    // disclosureEvent.count: [eligibleEvents, awaitingSummary]
    (prisma.disclosureEvent.count as jest.Mock)
      .mockResolvedValueOnce(70) // eligibleEvents
      .mockResolvedValueOnce(15); // awaitingSummary
    (prisma.disclosureEvent.findFirst as jest.Mock).mockResolvedValue(null); // no pending event age
    (prisma.disclosureAnalysis.count as jest.Mock).mockResolvedValue(55); // summarized

    const service = new PipelineIntegrityService(
      prisma,
      makeDocs(),
      makeEvents(),
      null,
    );

    const health = await service.getHealth(NOW);

    expect(health.generatedAt).toBe(NOW.toISOString());
    expect(health.collection).toEqual({ total: 100, last24h: 12, missingDocument: 3 });
    expect(health.parsing.done).toBe(80);
    expect(health.parsing.pending).toBe(5);
    expect(health.parsing.parseFailed).toBe(2);
    expect(health.parsing.retryable).toBe(2);
    expect(health.parsing.oldestPendingAgeMinutes).toBe(90);
    expect(health.events.success).toBe(60);
    expect(health.events.needsReview).toBe(10);
    expect(health.events.missingForParsedDocs).toBe(4);
    expect(health.events.oldestPendingAgeMinutes).toBeNull();
    expect(health.ai).toEqual({
      eligibleEvents: 70,
      summarized: 55,
      awaitingSummary: 15,
    });
  });

  it('표본 0건이면 모든 카운터가 0·지연 null(graceful 기본값)', async () => {
    const service = new PipelineIntegrityService(
      makePrisma(),
      makeDocs(),
      makeEvents(),
      null,
    );
    const health = await service.getHealth(NOW);
    expect(health.parsing.pending).toBe(0);
    expect(health.parsing.oldestPendingAgeMinutes).toBeNull();
    expect(health.events.oldestPendingAgeMinutes).toBeNull();
    expect(health.ai.awaitingSummary).toBe(0);
    expect(health.recentFailures).toEqual([]);
  });

  // ─── DAR-392 getDrainProgress ─────────────────────────────────────────────
  it('파싱 DONE%·잔여 백로그·ETA 를 read-only 로 집계한다', async () => {
    const prisma = makePrisma();
    // groupBy: total=1000, done=700(70%), pending(PENDING+FETCHING)=300
    (prisma.disclosureDocument.groupBy as jest.Mock).mockResolvedValue([
      { parseStatus: ParseStatus.DONE, _count: { _all: 700 } },
      { parseStatus: ParseStatus.PENDING, _count: { _all: 280 } },
      { parseStatus: ParseStatus.FETCHING, _count: { _all: 20 } },
    ]);
    (prisma.disclosureDocument.count as jest.Mock).mockResolvedValueOnce(50); // retryable
    (prisma.disclosure.count as jest.Mock).mockResolvedValueOnce(600); // missingDocument
    (prisma.disclosureEvent.count as jest.Mock).mockResolvedValueOnce(648); // eligibleEvents

    const service = new PipelineIntegrityService(
      prisma,
      makeDocs(),
      makeEvents(),
      null,
    );

    const p = await service.getDrainProgress(NOW);

    expect(p.generatedAt).toBe(NOW.toISOString());
    expect(p.parse.totalDocuments).toBe(1000);
    expect(p.parse.done).toBe(700);
    expect(p.parse.pending).toBe(300);
    expect(p.parse.retryable).toBe(50);
    expect(p.parse.donePercent).toBe(70);
    expect(p.missingDocument).toBe(600);
    expect(p.eligibleEvents).toBe(648);
    expect(p.nominalParsePerMinute).toBe(140);
    // backlog = pending(300)+missing(600)=900 → 900/140/60 ≈ 0.107 → 0.1h
    expect(p.etaHours).toBe(0.1);
  });

  it('문서 0건이면 donePercent·etaHours 0(graceful)', async () => {
    const service = new PipelineIntegrityService(
      makePrisma(),
      makeDocs(),
      makeEvents(),
      null,
    );
    const p = await service.getDrainProgress(NOW);
    expect(p.parse.totalDocuments).toBe(0);
    expect(p.parse.donePercent).toBe(0);
    expect(p.etaHours).toBe(0);
  });

  it('실패 행을 단계 혼합·최신순으로 가시화한다', async () => {
    const prisma = makePrisma();
    (prisma.disclosureDocument.findMany as jest.Mock).mockResolvedValue([
      {
        rcpNo: 'p1',
        parseStatus: ParseStatus.PARSE_FAILED,
        lastError: 'boom',
        retryCount: 2,
        updatedAt: new Date('2026-06-08T11:00:00.000Z'),
      },
    ]);
    (prisma.disclosureEvent.findMany as jest.Mock).mockResolvedValue([
      {
        rcpNo: 'e1',
        extractionStatus: ExtractionStatus.FAILED,
        failReason: 'NO_PARSED_FIELD',
        updatedAt: new Date('2026-06-08T11:30:00.000Z'),
      },
    ]);
    const service = new PipelineIntegrityService(
      prisma,
      makeDocs(),
      makeEvents(),
      null,
    );
    const health = await service.getHealth(NOW);
    // e1(11:30) 이 p1(11:00) 보다 최신 → 먼저.
    expect(health.recentFailures.map((r) => r.rcpNo)).toEqual(['e1', 'p1']);
    expect(health.recentFailures[0].stage).toBe('EVENT');
    expect(health.recentFailures[1]).toMatchObject({
      stage: 'PARSE',
      detail: 'boom',
      retryCount: 2,
    });
  });

  // ─── backfill / drain ───────────────────────────────────────────────────────

  it('수집됐으나 파싱 큐 미등록 공시를 enqueueParsing 으로 backfill 한다', async () => {
    const prisma = makePrisma();
    (prisma.disclosure.findMany as jest.Mock).mockResolvedValue([
      { rcpNo: 'a' },
      { rcpNo: 'b' },
    ]);
    const docs = makeDocs();
    const service = new PipelineIntegrityService(prisma, docs, makeEvents(), null);

    const n = await service.backfillMissingDocuments(50);

    expect(n).toBe(2);
    expect(docs.enqueueParsing).toHaveBeenCalledWith(['a', 'b']);
  });

  it('누락이 없으면 enqueueParsing 을 호출하지 않는다(멱등·무부작용)', async () => {
    const docs = makeDocs();
    const service = new PipelineIntegrityService(
      makePrisma(),
      docs,
      makeEvents(),
      null,
    );
    const n = await service.backfillMissingDocuments();
    expect(n).toBe(0);
    expect(docs.enqueueParsing).not.toHaveBeenCalled();
  });

  it('drainOnce 는 backfill→파싱→이벤트 순서로 폐루프를 닫고 결과를 합산한다', async () => {
    const calls: string[] = [];
    const prisma = makePrisma();
    (prisma.disclosure.findMany as jest.Mock).mockResolvedValue([{ rcpNo: 'm1' }]);

    const docs = makeDocs({
      enqueueParsing: jest.fn().mockImplementation(async () => {
        calls.push('enqueue');
      }),
      processPendingBatch: jest.fn().mockImplementation(async () => {
        calls.push('parse');
        return { success: 3, failed: 1, durationMs: 5 };
      }),
    });
    const events = makeEvents({
      processPendingDisclosures: jest.fn().mockImplementation(async () => {
        calls.push('events');
        return { success: 2, failed: 0, needsReview: 1, durationMs: 7 };
      }),
    });

    const service = new PipelineIntegrityService(prisma, docs, events, null);
    const result = await service.drainOnce(100);

    expect(calls).toEqual(['enqueue', 'parse', 'events']);
    expect(result.enqueuedMissingDocuments).toBe(1);
    expect(result.parse).toEqual({ success: 3, failed: 1 });
    expect(result.events).toEqual({ success: 2, failed: 0, needsReview: 1 });
  });

  it('한 단계가 throw 해도 다음 단계를 진행한다(부분 진행 보장)', async () => {
    const prisma = makePrisma();
    (prisma.disclosure.findMany as jest.Mock).mockResolvedValue([]);
    const docs = makeDocs({
      processPendingBatch: jest.fn().mockRejectedValue(new Error('parse down')),
    });
    const events = makeEvents({
      processPendingDisclosures: jest
        .fn()
        .mockResolvedValue({ success: 5, failed: 0, needsReview: 0, durationMs: 1 }),
    });
    const service = new PipelineIntegrityService(prisma, docs, events, null);

    const result = await service.drainOnce();
    // 파싱 단계는 폴백(0/0), 이벤트 단계는 정상 진행.
    expect(result.parse).toEqual({ success: 0, failed: 0 });
    expect(result.events.success).toBe(5);
    expect(events.processPendingDisclosures).toHaveBeenCalled();
  });

  // ─── AI 재발행(수동) ─────────────────────────────────────────────────────────

  it('reprocessMissingAi 는 summary 미도달 자격 이벤트를 큐에 재발행한다(페이로드 정합)', async () => {
    const prisma = makePrisma();
    (prisma.disclosureEvent.findMany as jest.Mock).mockResolvedValue([
      {
        rcpNo: 'r1',
        corpCode: 'c1',
        eventType: 'SUPPLY_CONTRACT',
        polarity: 'POSITIVE',
        confidence: 0.9,
        isAiAssisted: false,
      },
    ]);
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const service = new PipelineIntegrityService(
      prisma,
      makeDocs(),
      makeEvents(),
      queue as never,
    );

    const result = await service.reprocessMissingAi(10);

    expect(result).toEqual({ scanned: 1, reEnqueued: 1 });
    expect(queue.add).toHaveBeenCalledTimes(1);
    const [jobName, payload, options] = queue.add.mock.calls[0];
    expect(jobName).toBe(JOB.EVENT_EXTRACTED);
    expect(payload).toMatchObject({
      rcpNo: 'r1',
      corpCode: 'c1',
      eventType: 'SUPPLY_CONTRACT',
      polarity: 'POSITIVE',
      confidence: 0.9,
      isAiAssisted: false,
    });
    // DAR-230: 이벤트추출 경로와 동일 자연키 jobId(ai-<rcpNo>)로 발행 → 다경로 중복 적재 방지.
    expect(options.jobId).toBe('ai-r1');
  });

  // DAR-230 DoD: 동일 rcpNo 를 다경로(reprocess 반복/드레인)에서 2회 add 해도
  // BullMQ 의 jobId dedup 으로 큐엔 1건만 적재된다. 실제 BullMQ dedup 규약을
  // 모사한 FakeBullQueue 로 producer 경로(reprocessMissingAi)를 검증한다.
  it('DAR-230: 동일 rcpNo 2회 발행 → 큐 1건만 적재(jobId dedup)', async () => {
    // BullMQ dedup 모사: 동일 jobId 잡이 이미 존재하면 add 를 무시(중복 미적재).
    const store = new Map<string, unknown>();
    const fakeQueue = {
      add: jest.fn(async (_name: string, data: unknown, opts: { jobId?: string }) => {
        const id = opts?.jobId ?? `auto:${store.size}`;
        if (!store.has(id)) store.set(id, data);
      }),
    };
    const candidate = {
      rcpNo: 'r1',
      corpCode: 'c1',
      eventType: 'SUPPLY_CONTRACT',
      polarity: 'POSITIVE',
      confidence: 0.9,
      isAiAssisted: false,
    };
    const prisma = makePrisma();
    (prisma.disclosureEvent.findMany as jest.Mock).mockResolvedValue([candidate]);
    const service = new PipelineIntegrityService(
      prisma,
      makeDocs(),
      makeEvents(),
      fakeQueue as never,
    );

    // 다경로 재발행 2회(예: 첫 reprocess 후 드레인/재실행).
    await service.reprocessMissingAi(10);
    await service.reprocessMissingAi(10);

    expect(fakeQueue.add).toHaveBeenCalledTimes(2); // producer 는 2회 호출하지만
    expect(store.size).toBe(1); // ★큐에는 1건만 적재(dedup)
    expect([...store.keys()]).toEqual(['ai-r1']);
  });

  it('큐 미가용(null) 시 재발행은 0(graceful)', async () => {
    const prisma = makePrisma();
    (prisma.disclosureEvent.findMany as jest.Mock).mockResolvedValue([
      { rcpNo: 'r1', corpCode: 'c1', eventType: 'OTHER', polarity: 'UNKNOWN', confidence: 0, isAiAssisted: false },
    ]);
    const service = new PipelineIntegrityService(
      prisma,
      makeDocs(),
      makeEvents(),
      null,
    );
    const result = await service.reprocessMissingAi();
    expect(result).toEqual({ scanned: 1, reEnqueued: 0 });
  });
});
