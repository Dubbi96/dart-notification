// backend/src/disclosure-events/disclosure-events.service.spec.ts
// processDisclosure 파이프라인 단위 테스트 (픽스처 기반, DB mock)

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EventType, ExtractionStatus } from '@prisma/client';
import { DisclosureEventsService } from './disclosure-events.service';
import { PrismaService } from '../../prisma/prisma.service';
import { getQueueToken } from '@nestjs/bullmq';
import { QUEUE, JOB, AI_ANALYZE_JOB_OPTIONS } from '../../common/queues/queue.constants';

// ─── DB mock ────────────────────────────────────────────────────────────────

const mockPrismaService = {
  disclosure: {
    findUnique: jest.fn(),
  },
  disclosureDocument: {
    findUnique: jest.fn(),
  },
  disclosureEvent: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    upsert: jest.fn(),
  },
};

// 큐 mock — add 호출 여부만 검증
const mockAiQueue = { add: jest.fn().mockResolvedValue(undefined) };

// ─── 픽스처 ─────────────────────────────────────────────────────────────────

const supplyContractDisclosure = {
  rcpNo: '20240601000001',
  corpCode: '00126380',
  corpName: '테스트코퍼레이션',
  reportName: '단일판매·공급계약체결',
  rcpDt: '20240601',
  flrName: '테스트코퍼레이션',
  rmk: '',
  disclosureType: 'MATERIAL',
};

const supplyContractDoc = {
  rcpNo: '20240601000001',
  corpCode: '00126380',
  parseStatus: 'DONE',
  isAmendment: false,
  originalRcpNo: null,
  parsedJson: {
    docType: 'SUPPLY_CONTRACT',
    rawTableCount: 1,
    keyValueSource: 'table_0',
    contractAmount: 120_000_000_000,
    recentSales: 500_000_000_000,
    salesRatio: 0.24,
    counterparty: '글로벌바이어주식회사',
    contractStartDate: '2024-06-01',
    contractEndDate: '2025-05-31',
  },
};

const cbDisclosure = {
  rcpNo: '20240701000001',
  corpCode: '00126380',
  corpName: '테스트코퍼레이션',
  reportName: '전환사채 발행 결정',
  rcpDt: '20240701',
  flrName: '테스트코퍼레이션',
  rmk: '',
  disclosureType: 'MATERIAL',
};

const cbDoc = {
  rcpNo: '20240701000001',
  corpCode: '00126380',
  parseStatus: 'DONE',
  isAmendment: false,
  originalRcpNo: null,
  parsedJson: {
    docType: 'CB_BW_ISSUANCE',
    rawTableCount: 2,
    keyValueSource: 'table_0',
    bondType: 'CB',
    issuanceAmount: 30_000_000_000,
    interestRate: 0.0,
    conversionPrice: 4_500,
    maturityDate: '2029-06-01',
  },
};

// ─── 테스트 ──────────────────────────────────────────────────────────────────

describe('DisclosureEventsService', () => {
  let service: DisclosureEventsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DisclosureEventsService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: getQueueToken(QUEUE.AI_ANALYZE), useValue: mockAiQueue },
      ],
    }).compile();

    service = module.get<DisclosureEventsService>(DisclosureEventsService);

    // 기본 upsert mock — 입력 데이터를 그대로 반환
    mockPrismaService.disclosureEvent.upsert.mockImplementation(
      ({ create }: { create: Record<string, unknown> }) => ({
        id: 'mock-id',
        ...create,
        extractedAt: new Date(),
        updatedAt: new Date(),
      }),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('processDisclosure — 공급계약', () => {
    beforeEach(() => {
      mockPrismaService.disclosure.findUnique.mockResolvedValue(supplyContractDisclosure);
      mockPrismaService.disclosureDocument.findUnique.mockResolvedValue(supplyContractDoc);
    });

    it('SUCCESS 상태로 저장', async () => {
      const result = await service.processDisclosure('20240601000001');
      expect(result.extractionStatus).toBe(ExtractionStatus.SUCCESS);
      expect(result.eventType).toBe(EventType.SUPPLY_CONTRACT);
      expect(result.polarity).toBe('POSITIVE');
      expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    });

    // DAR-291: doc 조회는 사용 컬럼만 select → rawText(@db.Text, 200KB) over-fetch 방지.
    // DAR-339: SHARE_BUYBACK 추출 폴백 스캔용으로 tables(영속 원본 표) 추가 — 여전히 rawText 제외.
    it('DisclosureDocument 조회에 사용 컬럼만 select 적용(rawText over-fetch 방지)', async () => {
      await service.processDisclosure('20240601000001');

      expect(mockPrismaService.disclosureDocument.findUnique).toHaveBeenCalledWith({
        where: { rcpNo: '20240601000001' },
        select: { parsedJson: true, tables: true, isAmendment: true, originalRcpNo: true },
      });
    });

    it('extractedData에 contractAmount 포함', async () => {
      const result = await service.processDisclosure('20240601000001');
      const data = result.extractedData as Record<string, unknown>;
      expect(data['contractAmount']).toBe(120_000_000_000);
      expect(data['recentSales']).toBe(500_000_000_000);
      expect(data['salesRatio']).toBe(24.0);
    });

    // DAR-89: AI_ANALYZE 큐 발행 시 재시도·DLQ 정책 옵션이 적용돼야 LLM 일시
    // 장애(429/5xx/타임아웃)에 잡이 영구 소멸되지 않는다.
    it('AI_ANALYZE 큐 발행에 재시도·DLQ 정책 옵션 적용(attempts·backoff·removeOnFail 보존)', async () => {
      await service.processDisclosure('20240601000001');

      expect(mockAiQueue.add).toHaveBeenCalledWith(
        JOB.EVENT_EXTRACTED,
        expect.objectContaining({ rcpNo: '20240601000001' }),
        // DAR-230: 기존 정책 옵션 + 자연키 jobId(ai-<rcpNo>) 둘 다 적용.
        expect.objectContaining({
          ...AI_ANALYZE_JOB_OPTIONS,
          jobId: 'ai-20240601000001',
        }),
      );
      // 정책 값 명세: 3회 재시도·exponential backoff·실패 잡 보존(영구 소멸 방지).
      expect(AI_ANALYZE_JOB_OPTIONS.attempts).toBe(3);
      expect(AI_ANALYZE_JOB_OPTIONS.backoff).toEqual({ type: 'exponential', delay: 5000 });
      expect(AI_ANALYZE_JOB_OPTIONS.removeOnFail).toBe(100);
      // removeOnFail 보존(>0)이어야 ai-cost health가 실패 잡 수를 관측할 수 있다.
      expect(AI_ANALYZE_JOB_OPTIONS.removeOnFail).toBeGreaterThan(0);
    });
  });

  describe('processDisclosure — 전환사채', () => {
    beforeEach(() => {
      mockPrismaService.disclosure.findUnique.mockResolvedValue(cbDisclosure);
      mockPrismaService.disclosureDocument.findUnique.mockResolvedValue(cbDoc);
    });

    it('CB_ISSUANCE 이벤트 분류', async () => {
      const result = await service.processDisclosure('20240701000001');
      expect(result.eventType).toBe(EventType.CB_ISSUANCE);
      expect(result.polarity).toBe('NEGATIVE');
    });

    it('maxDilutionShares 파생값 계산', async () => {
      const result = await service.processDisclosure('20240701000001');
      const data = result.extractedData as Record<string, unknown>;
      expect(data['maxDilutionShares']).toBe(6_666_666);
    });
  });

  describe('processDisclosure — parsedJson 없음', () => {
    it('parsedJson null → FAILED 상태', async () => {
      mockPrismaService.disclosure.findUnique.mockResolvedValue(supplyContractDisclosure);
      mockPrismaService.disclosureDocument.findUnique.mockResolvedValue({
        ...supplyContractDoc,
        parsedJson: null,
      });

      const result = await service.processDisclosure('20240601000001');
      expect(result.extractionStatus).toBe(ExtractionStatus.FAILED);
      expect(result.failReason).toBe('NO_PARSED_DOC');
    });

    it('DisclosureDocument 없음 → FAILED 상태', async () => {
      mockPrismaService.disclosure.findUnique.mockResolvedValue(supplyContractDisclosure);
      mockPrismaService.disclosureDocument.findUnique.mockResolvedValue(null);

      const result = await service.processDisclosure('20240601000001');
      expect(result.extractionStatus).toBe(ExtractionStatus.FAILED);
    });
  });

  describe('processDisclosure — Disclosure 없음', () => {
    it('Disclosure 없음 → FAILED 상태 (throw 없음)', async () => {
      mockPrismaService.disclosure.findUnique.mockResolvedValue(null);
      // upsertFailed에서 Disclosure 조회 시도
      mockPrismaService.disclosureEvent.upsert.mockResolvedValue({
        id: 'mock-id',
        rcpNo: '99999999',
        extractionStatus: ExtractionStatus.FAILED,
      });

      // throw하지 않고 FAILED 상태 반환
      const result = await service.processDisclosure('99999999');
      expect(result).toBeDefined();
    });
  });

  describe('processDisclosure — confidence 임계값', () => {
    it('confidence < 0.60 → NEEDS_REVIEW', async () => {
      // 보고서명 분류 불가 + docType 없음 → OTHER, confidence 0.40
      mockPrismaService.disclosure.findUnique.mockResolvedValue({
        ...supplyContractDisclosure,
        reportName: '기타 주요사항',
      });
      mockPrismaService.disclosureDocument.findUnique.mockResolvedValue({
        ...supplyContractDoc,
        parsedJson: {
          docType: '',
          rawTableCount: 0,
          keyValueSource: 'none',
        },
      });

      const result = await service.processDisclosure('20240601000001');
      expect(result.extractionStatus).toBe(ExtractionStatus.NEEDS_REVIEW);
      expect(result.isAiAssisted).toBe(true);
    });
  });

  // ─── DAR-337: 추출 커버리지 확대 — FAILED 복구 ─────────────────────────────
  // 분류는 확실(≥0.85)하나 문서 Rule 수치가 비면 FAILED(분류 불가 의미)가 아니라
  // NEEDS_REVIEW(AI L1/insider 보강 대기)로 회수한다. MAJOR_HOLDER_5PCT(611건)가 대표.
  describe('processDisclosure — DAR-337 분류확실·수치부재 회수', () => {
    const major5PctDisclosure = {
      ...supplyContractDisclosure,
      rcpNo: '20240801000001',
      reportName: '주식등의 대량보유상황보고서',
    };

    it('MAJOR_HOLDER_5PCT: 보유비율 부재(과거 FAILED 611건) → NEEDS_REVIEW(AWAITING_AI_L1)로 복구', async () => {
      mockPrismaService.disclosure.findUnique.mockResolvedValue(major5PctDisclosure);
      mockPrismaService.disclosureDocument.findUnique.mockResolvedValue({
        ...supplyContractDoc,
        rcpNo: '20240801000001',
        // 5%룰 보고는 보유 parsedJson에 구조화 필드가 없는 경우가 일반적(frozen).
        parsedJson: { docType: 'OTHER', rawTableCount: 0, keyValueSource: 'none' },
      });

      const result = await service.processDisclosure('20240801000001');
      expect(result.eventType).toBe(EventType.MAJOR_HOLDER_5PCT);
      // 핵심 회귀고정: FAILED 아님.
      expect(result.extractionStatus).toBe(ExtractionStatus.NEEDS_REVIEW);
      expect(result.extractionStatus).not.toBe(ExtractionStatus.FAILED);
      expect(result.failReason).toBe('AWAITING_AI_L1');
      expect(result.isAiAssisted).toBe(true);
    });

    it('MAJOR_HOLDER_5PCT: 보유비율 존재 → SUCCESS 승격', async () => {
      mockPrismaService.disclosure.findUnique.mockResolvedValue(major5PctDisclosure);
      mockPrismaService.disclosureDocument.findUnique.mockResolvedValue({
        ...supplyContractDoc,
        rcpNo: '20240801000001',
        parsedJson: {
          docType: 'OTHER',
          rawTableCount: 1,
          keyValueSource: 'table_0',
          holdingRatio: 8.52,
          previousHoldingRatio: 6.31,
        },
      });

      const result = await service.processDisclosure('20240801000001');
      expect(result.eventType).toBe(EventType.MAJOR_HOLDER_5PCT);
      expect(result.extractionStatus).toBe(ExtractionStatus.SUCCESS);
      const data = result.extractedData as Record<string, unknown>;
      expect(data['holdingRatio']).toBe(8.52);
    });

    it('일반 하드타입(SHARE_BUYBACK)도 분류확실·수치부재 시 FAILED→NEEDS_REVIEW로 회수', async () => {
      mockPrismaService.disclosure.findUnique.mockResolvedValue({
        ...supplyContractDisclosure,
        rcpNo: '20240802000001',
        reportName: '자기주식 취득 결정',
      });
      mockPrismaService.disclosureDocument.findUnique.mockResolvedValue({
        ...supplyContractDoc,
        rcpNo: '20240802000001',
        parsedJson: { docType: 'SHARE_BUYBACK', rawTableCount: 0, keyValueSource: 'none' },
      });

      const result = await service.processDisclosure('20240802000001');
      expect(result.eventType).toBe(EventType.SHARE_BUYBACK);
      expect(result.extractionStatus).toBe(ExtractionStatus.NEEDS_REVIEW);
      expect(result.failReason).toBe('AWAITING_AI_L1');
    });

    it('음성 대조군: 분류 confidence가 낮은(docType 0.70) 수치부재 건은 FAILED(NO_PARSED_FIELD) 유지', async () => {
      // 보고서명 미매칭 + docType=SHARE_BUYBACK(2차 보완 0.70 < 0.85) → 회수 대상 아님.
      mockPrismaService.disclosure.findUnique.mockResolvedValue({
        ...supplyContractDisclosure,
        rcpNo: '20240803000001',
        reportName: '기타 경영사항 안내',
      });
      mockPrismaService.disclosureDocument.findUnique.mockResolvedValue({
        ...supplyContractDoc,
        rcpNo: '20240803000001',
        parsedJson: { docType: 'SHARE_BUYBACK', rawTableCount: 0, keyValueSource: 'none' },
      });

      const result = await service.processDisclosure('20240803000001');
      expect(result.extractionStatus).toBe(ExtractionStatus.FAILED);
      expect(result.failReason).toBe('NO_PARSED_FIELD');
    });
  });

  describe('computeDerivedValues', () => {
    it('SUPPLY_CONTRACT salesRatio 계산', () => {
      const result = service.computeDerivedValues(EventType.SUPPLY_CONTRACT, {
        contractAmount: 100_000_000_000,
        recentSales: 500_000_000_000,
      });
      expect(result['salesRatio']).toBe(20.0);
    });

    it('PAID_IN_CAPITAL_INCREASE dilutionRate 계산 (SSOT)', () => {
      const result = service.computeDerivedValues(EventType.PAID_IN_CAPITAL_INCREASE, {
        newShares: 10_000_000,
        existingShares: 50_000_000,
      });
      // SSOT: 10M / (10M + 50M) * 100 = 16.67%
      expect(result['dilutionRate']).toBe(16.67);
    });

    it('CB_ISSUANCE maxDilutionShares 계산', () => {
      const result = service.computeDerivedValues(EventType.CB_ISSUANCE, {
        totalAmount: 30_000_000_000,
        conversionPrice: 4_500,
      });
      expect(result['maxDilutionShares']).toBe(6_666_666);
    });

    it('분모 0 → 파생값 null', () => {
      const result = service.computeDerivedValues(EventType.SUPPLY_CONTRACT, {
        contractAmount: 10_000_000_000,
        recentSales: 0,
      });
      // salesRatio 계산 시도하지만 0으로 나누기 방어
      expect(result['salesRatio']).toBeUndefined();
    });
  });

  describe('findOne', () => {
    it('이벤트 존재 시 반환', async () => {
      const mockEvent = { id: 'event-id', rcpNo: '20240601000001' };
      mockPrismaService.disclosureEvent.findUnique.mockResolvedValue(mockEvent);

      const result = await service.findOne('20240601000001');
      expect(result).toEqual(mockEvent);
    });

    it('이벤트 없으면 NotFoundException', async () => {
      mockPrismaService.disclosureEvent.findUnique.mockResolvedValue(null);

      await expect(service.findOne('NONEXIST')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── DAR-289: 페이지네이션 tie-break ─────────────────────────────────────────
  // extractedAt 이 동값(배치 추출)일 때, orderBy 에 유니크 tie-break 가 없으면
  // Postgres 는 동값 행 순서를 보장하지 않아 페이지 경계에서 중복/누락이 난다.
  // 아래 fake findMany 는 그 불안정성을 모델링한다: orderBy 키로 정렬한 뒤,
  // 모든 키가 동값이라 순서가 미결정된 그룹을 호출 시퀀스마다 회전시킨다.
  describe('findMany — 페이지네이션 tie-break (DAR-289)', () => {
    const sameTs = new Date('2026-06-15T00:00:00.000Z');
    const rows = [
      { id: 'e1', rcpNo: '20260615000001', corpCode: 'C', extractedAt: sameTs },
      { id: 'e2', rcpNo: '20260615000002', corpCode: 'C', extractedAt: sameTs },
      { id: 'e3', rcpNo: '20260615000003', corpCode: 'C', extractedAt: sameTs },
      { id: 'e4', rcpNo: '20260615000004', corpCode: 'C', extractedAt: sameTs },
    ];

    // orderBy 배열을 실제로 적용하고, 미결정 tie 그룹을 호출마다 회전시키는 fake.
    let callSeq = 0;
    const cmpBy =
      (orderBy: Array<Record<string, 'asc' | 'desc'>>) =>
      (a: Record<string, unknown>, b: Record<string, unknown>): number => {
        for (const o of orderBy) {
          const field = Object.keys(o)[0];
          const dir = o[field];
          const av = a[field] as string | Date;
          const bv = b[field] as string | Date;
          const c = av < bv ? -1 : av > bv ? 1 : 0;
          if (c !== 0) return dir === 'desc' ? -c : c;
        }
        return 0;
      };
    const unstableFindMany = jest.fn(
      async ({
        orderBy,
        skip = 0,
        take,
      }: {
        orderBy: Array<Record<string, 'asc' | 'desc'>>;
        skip?: number;
        take?: number;
      }) => {
        const cmp = cmpBy(Array.isArray(orderBy) ? orderBy : [orderBy]);
        const sorted = [...rows].sort(cmp);
        const seq = callSeq++;
        const groups: Array<Array<Record<string, unknown>>> = [];
        for (const r of sorted) {
          const last = groups[groups.length - 1];
          if (last && cmp(last[0], r) === 0) last.push(r);
          else groups.push([r]);
        }
        const flat = groups.flatMap((g) => {
          if (g.length <= 1) return g;
          const off = seq % g.length;
          return [...g.slice(off), ...g.slice(0, off)];
        });
        return flat.slice(skip, take == null ? undefined : skip + take);
      },
    );

    beforeEach(() => {
      callSeq = 0;
      mockPrismaService.disclosureEvent.findMany.mockImplementation(unstableFindMany);
      mockPrismaService.disclosureEvent.count.mockResolvedValue(rows.length);
    });

    it('동값 extractedAt 다건에서 2페이지 연속 조회 시 union=전체·교집합=0', async () => {
      const p1 = await service.findMany({ corpCode: 'C', page: 1, limit: 2 });
      const p2 = await service.findMany({ corpCode: 'C', page: 2, limit: 2 });

      const ids1 = p1.items.map((e) => e.id);
      const ids2 = p2.items.map((e) => e.id);
      const union = new Set([...ids1, ...ids2]);
      const intersection = ids1.filter((id) => ids2.includes(id));

      expect(union.size).toBe(rows.length); // 누락 0
      expect(intersection).toHaveLength(0); // 중복 0
    });

    it('서비스는 유니크 tie-break(rcpNo)를 orderBy 마지막에 전달한다', async () => {
      await service.findMany({ corpCode: 'C', page: 1, limit: 2 });
      const passed = (mockPrismaService.disclosureEvent.findMany as jest.Mock).mock
        .calls[0][0].orderBy;
      expect(passed).toEqual([{ extractedAt: 'desc' }, { rcpNo: 'desc' }]);
    });

    it('대조군: tie-break 없는 단일 키 정렬은 동일 fake 에서 중복/누락이 발생한다', async () => {
      // fake 의 불안정성 모델이 실재함을 입증(테스트에 teeth 부여).
      const single = [{ extractedAt: 'desc' as const }];
      const page1 = (await unstableFindMany({ orderBy: single, skip: 0, take: 2 })).map(
        (e) => e.id as string,
      );
      const page2 = (await unstableFindMany({ orderBy: single, skip: 2, take: 2 })).map(
        (e) => e.id as string,
      );
      const union = new Set([...page1, ...page2]);
      const intersection = page1.filter((id) => page2.includes(id));
      expect(union.size).toBeLessThan(rows.length); // 누락 발생
      expect(intersection.length).toBeGreaterThan(0); // 중복 발생
    });
  });
});
