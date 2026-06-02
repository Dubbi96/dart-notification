// backend/src/disclosure-events/disclosure-events.service.spec.ts
// processDisclosure 파이프라인 단위 테스트 (픽스처 기반, DB mock)

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EventType, ExtractionStatus } from '@prisma/client';
import { DisclosureEventsService } from './disclosure-events.service';
import { PrismaService } from '../prisma/prisma.service';

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

    it('extractedData에 contractAmount 포함', async () => {
      const result = await service.processDisclosure('20240601000001');
      const data = result.extractedData as Record<string, unknown>;
      expect(data['contractAmount']).toBe(120_000_000_000);
      expect(data['recentSales']).toBe(500_000_000_000);
      expect(data['salesRatio']).toBe(24.0);
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

  describe('computeDerivedValues', () => {
    it('SUPPLY_CONTRACT salesRatio 계산', () => {
      const result = service.computeDerivedValues(EventType.SUPPLY_CONTRACT, {
        contractAmount: 100_000_000_000,
        recentSales: 500_000_000_000,
      });
      expect(result['salesRatio']).toBe(20.0);
    });

    it('PAID_IN_CAPITAL_INCREASE dilutionRate 계산', () => {
      const result = service.computeDerivedValues(EventType.PAID_IN_CAPITAL_INCREASE, {
        newShares: 10_000_000,
        existingShares: 50_000_000,
      });
      expect(result['dilutionRate']).toBe(20.0);
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
});
