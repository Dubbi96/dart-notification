import { Test, TestingModule } from '@nestjs/testing';
import { Job } from 'bullmq';
import { EventExtractedConsumer } from './event-extracted.consumer';
import { AiAnalystService } from '../ai-analyst.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DartStockStatusService } from '../../engine3-quant-market/market-data/dart-stock-status.service';
import { JOB, AiAnalyzeJobData } from '../../common/queues/queue.constants';

const mockAiAnalystService = {
  runSummary: jest.fn(),
  runPersonaInterpretation: jest.fn(),
  runPositionThesis: jest.fn(),
};

const mockPrisma = {
  disclosureDocument: { findUnique: jest.fn() },
  disclosureEvent: { findUnique: jest.fn() },
  stockDailyPrice: { findFirst: jest.fn() },
  position: { count: jest.fn() },
  tradingSignal: { findFirst: jest.fn() },
};

/** Summary 산출물 — Persona/Thesis 입력으로 전달되는지 검증용. */
const summaryDraft = {
  summary: '대규모 공급계약 체결',
  positiveFactors: ['매출 증대'],
  negativeFactors: [],
  polarity: 'POSITIVE' as const,
};

const mockDartStockStatus = {
  isManagementStock: jest.fn(),
};

function makeJob(name: string, data: AiAnalyzeJobData): Job<AiAnalyzeJobData> {
  return { name, data } as unknown as Job<AiAnalyzeJobData>;
}

const baseData: AiAnalyzeJobData = {
  rcpNo: '20240601000001',
  corpCode: '00126380',
  eventType: 'SUPPLY_CONTRACT',
  polarity: 'POSITIVE',
  confidence: 0.9,
  isAiAssisted: false,
};

describe('EventExtractedConsumer', () => {
  let consumer: EventExtractedConsumer;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDartStockStatus.isManagementStock.mockResolvedValue(false); // 기본: 정상 종목
    mockPrisma.position.count.mockResolvedValue(0); // 기본: 미보유
    mockPrisma.tradingSignal.findFirst.mockResolvedValue(null); // 기본: 매칭 신호 없음
    mockAiAnalystService.runPersonaInterpretation.mockResolvedValue(null);
    mockAiAnalystService.runPositionThesis.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EventExtractedConsumer,
        { provide: AiAnalystService, useValue: mockAiAnalystService },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: DartStockStatusService, useValue: mockDartStockStatus },
      ],
    }).compile();

    consumer = module.get<EventExtractedConsumer>(EventExtractedConsumer);
  });

  it('DB에서 실데이터를 조회해 AI Task 입력을 충실화한다(하드코딩 스텁 제거)', async () => {
    mockPrisma.disclosureDocument.findUnique.mockResolvedValue({
      rawText: '당사는 대규모 단일판매·공급계약을 체결하였습니다.',
    });
    mockPrisma.disclosureEvent.findUnique.mockResolvedValue({
      extractedData: { contractAmount: 50_000_000_000, counterparty: 'ACME' },
    });
    mockPrisma.stockDailyPrice.findFirst.mockResolvedValue({
      tradingValue: BigInt(5_000_000_000),
      tradeDate: '20240531',
    });
    mockAiAnalystService.runSummary.mockResolvedValue(null);

    await consumer.process(makeJob(JOB.EVENT_EXTRACTED, baseData));

    expect(mockAiAnalystService.runSummary).toHaveBeenCalledTimes(1);
    const req = mockAiAnalystService.runSummary.mock.calls[0][0];

    // excerpt: DisclosureDocument.rawText 실값 (빈 문자열 아님)
    expect(req.input.excerpt).toContain('단일판매·공급계약');
    expect(req.input.excerpt).not.toBe('');
    // keyMetrics: DisclosureEvent.extractedData 실값 (빈 객체 아님)
    expect(req.input.keyMetrics).toEqual({
      contractAmount: 50_000_000_000,
      counterparty: 'ACME',
    });
    // tradingValue: StockDailyPrice 실값 (하드코딩 200_000_000 아님)
    expect(req.gate.tradingValue).toBe(5_000_000_000);
    expect(req.gate.tradingValue).not.toBe(200_000_000);

    // 거래대금 조회는 최신 거래일 + 결측 제외 조건으로 1건 조회
    expect(mockPrisma.stockDailyPrice.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { corpCode: '00126380', tradingValue: { not: null } },
        orderBy: { tradeDate: 'desc' },
      }),
    );
  });

  it('실거래대금 실값이 게이트 입력으로 그대로 전달된다(L0 분기 연결)', async () => {
    mockPrisma.disclosureDocument.findUnique.mockResolvedValue({ rawText: '본문' });
    mockPrisma.disclosureEvent.findUnique.mockResolvedValue({ extractedData: {} });
    mockPrisma.stockDailyPrice.findFirst.mockResolvedValue({
      tradingValue: BigInt(50_000_000),
      tradeDate: '20240531',
    });
    mockAiAnalystService.runSummary.mockResolvedValue(null);

    await consumer.process(makeJob(JOB.EVENT_EXTRACTED, baseData));

    const req = mockAiAnalystService.runSummary.mock.calls[0][0];
    expect(req.gate.tradingValue).toBe(50_000_000);
  });

  it('결측(공시문서/이벤트/시세 모두 없음) 시 빈 입력+거래대금 0으로 graceful 처리한다', async () => {
    mockPrisma.disclosureDocument.findUnique.mockResolvedValue(null);
    mockPrisma.disclosureEvent.findUnique.mockResolvedValue(null);
    mockPrisma.stockDailyPrice.findFirst.mockResolvedValue(null);
    mockAiAnalystService.runSummary.mockResolvedValue(null);

    await consumer.process(makeJob(JOB.EVENT_EXTRACTED, baseData));

    expect(mockAiAnalystService.runSummary).toHaveBeenCalledTimes(1);
    const req = mockAiAnalystService.runSummary.mock.calls[0][0];
    expect(req.input.excerpt).toBe('');
    expect(req.input.keyMetrics).toEqual({});
    expect(req.gate.tradingValue).toBe(0); // 하드코딩 상수 제거 — 결측은 0
  });

  it('DB 조회가 예외를 던져도 컨슈머는 깨지지 않고 빈 입력으로 진행한다', async () => {
    mockPrisma.disclosureDocument.findUnique.mockRejectedValue(new Error('db down'));
    mockPrisma.disclosureEvent.findUnique.mockRejectedValue(new Error('db down'));
    mockPrisma.stockDailyPrice.findFirst.mockRejectedValue(new Error('db down'));
    mockAiAnalystService.runSummary.mockResolvedValue(null);

    await expect(
      consumer.process(makeJob(JOB.EVENT_EXTRACTED, baseData)),
    ).resolves.toBeUndefined();

    const req = mockAiAnalystService.runSummary.mock.calls[0][0];
    expect(req.input.excerpt).toBe('');
    expect(req.input.keyMetrics).toEqual({});
    expect(req.gate.tradingValue).toBe(0);
  });

  it('event.extracted 잡을 수신하면 runSummary를 호출한다', async () => {
    mockPrisma.disclosureDocument.findUnique.mockResolvedValue(null);
    mockPrisma.disclosureEvent.findUnique.mockResolvedValue(null);
    mockPrisma.stockDailyPrice.findFirst.mockResolvedValue(null);
    mockAiAnalystService.runSummary.mockResolvedValue(null);

    await consumer.process(makeJob(JOB.EVENT_EXTRACTED, baseData));

    expect(mockAiAnalystService.runSummary).toHaveBeenCalledTimes(1);
    expect(mockAiAnalystService.runSummary).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ rcpNo: '20240601000001' }),
      }),
    );
  });

  it('관리종목 실데이터를 게이트 입력으로 전달한다(하드코딩 false 제거, DAR-69)', async () => {
    mockPrisma.disclosureDocument.findUnique.mockResolvedValue({ rawText: '본문' });
    mockPrisma.disclosureEvent.findUnique.mockResolvedValue({ extractedData: {} });
    mockPrisma.stockDailyPrice.findFirst.mockResolvedValue({
      tradingValue: BigInt(5_000_000_000),
      tradeDate: '20240531',
    });
    mockDartStockStatus.isManagementStock.mockResolvedValue(true); // 관리종목
    mockAiAnalystService.runSummary.mockResolvedValue(null);

    await consumer.process(makeJob(JOB.EVENT_EXTRACTED, baseData));

    expect(mockDartStockStatus.isManagementStock).toHaveBeenCalledWith('00126380');
    const req = mockAiAnalystService.runSummary.mock.calls[0][0];
    // 관리종목 실값이 게이트 입력으로 전달 → AiCostGate L0 차단(AI 미호출) 경로 활성
    expect(req.gate.isManagementStock).toBe(true);
  });

  it('정상 종목은 isManagementStock=false 로 전달된다', async () => {
    mockPrisma.disclosureDocument.findUnique.mockResolvedValue({ rawText: '본문' });
    mockPrisma.disclosureEvent.findUnique.mockResolvedValue({ extractedData: {} });
    mockPrisma.stockDailyPrice.findFirst.mockResolvedValue({
      tradingValue: BigInt(5_000_000_000),
      tradeDate: '20240531',
    });
    mockDartStockStatus.isManagementStock.mockResolvedValue(false);
    mockAiAnalystService.runSummary.mockResolvedValue(null);

    await consumer.process(makeJob(JOB.EVENT_EXTRACTED, baseData));

    const req = mockAiAnalystService.runSummary.mock.calls[0][0];
    expect(req.gate.isManagementStock).toBe(false);
  });

  it('관리종목 조회가 예외를 던져도 false 로 graceful 처리한다', async () => {
    mockPrisma.disclosureDocument.findUnique.mockResolvedValue(null);
    mockPrisma.disclosureEvent.findUnique.mockResolvedValue(null);
    mockPrisma.stockDailyPrice.findFirst.mockResolvedValue(null);
    mockDartStockStatus.isManagementStock.mockRejectedValue(new Error('db down'));
    mockAiAnalystService.runSummary.mockResolvedValue(null);

    await expect(
      consumer.process(makeJob(JOB.EVENT_EXTRACTED, baseData)),
    ).resolves.toBeUndefined();

    const req = mockAiAnalystService.runSummary.mock.calls[0][0];
    expect(req.gate.isManagementStock).toBe(false);
  });

  it('알 수 없는 잡 이름은 runSummary를 호출하지 않고 DB도 조회하지 않는다', async () => {
    const data: AiAnalyzeJobData = { ...baseData, rcpNo: '20240601000002', eventType: 'OTHER' };

    await consumer.process(makeJob('unknown.job', data));

    expect(mockAiAnalystService.runSummary).not.toHaveBeenCalled();
    expect(mockPrisma.disclosureDocument.findUnique).not.toHaveBeenCalled();
  });

  it('runSummary가 예외를 던지면 컨슈머가 예외를 전파한다(BullMQ 재시도)', async () => {
    mockPrisma.disclosureDocument.findUnique.mockResolvedValue(null);
    mockPrisma.disclosureEvent.findUnique.mockResolvedValue(null);
    mockPrisma.stockDailyPrice.findFirst.mockResolvedValue(null);
    mockAiAnalystService.runSummary.mockRejectedValue(new Error('LLM timeout'));

    await expect(
      consumer.process(makeJob(JOB.EVENT_EXTRACTED, { ...baseData, rcpNo: '20240601000003' })),
    ).rejects.toThrow('LLM timeout');
  });

  // ─── DAR-74: 보유종목 실조회 → 게이트 isHolding 실공급 ───────────────────
  describe('DAR-74 — isHolding 실데이터 공급', () => {
    function primeEnrichment() {
      mockPrisma.disclosureDocument.findUnique.mockResolvedValue({ rawText: '본문' });
      mockPrisma.disclosureEvent.findUnique.mockResolvedValue({ extractedData: {} });
      mockPrisma.stockDailyPrice.findFirst.mockResolvedValue({
        tradingValue: BigInt(5_000_000_000),
        tradeDate: '20240531',
      });
      mockAiAnalystService.runSummary.mockResolvedValue(null);
    }

    it('OPEN 포지션이 있으면 게이트 isHolding=true 로 전달한다', async () => {
      primeEnrichment();
      mockPrisma.position.count.mockResolvedValue(1); // 보유

      await consumer.process(makeJob(JOB.EVENT_EXTRACTED, baseData));

      expect(mockPrisma.position.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { corpCode: '00126380', status: { in: ['OPEN', 'PARTIAL'] } },
        }),
      );
      const req = mockAiAnalystService.runSummary.mock.calls[0][0];
      expect(req.gate.isHolding).toBe(true);
    });

    it('OPEN 포지션이 없으면 게이트 isHolding=false 로 전달한다', async () => {
      primeEnrichment();
      mockPrisma.position.count.mockResolvedValue(0); // 미보유

      await consumer.process(makeJob(JOB.EVENT_EXTRACTED, baseData));

      const req = mockAiAnalystService.runSummary.mock.calls[0][0];
      expect(req.gate.isHolding).toBe(false);
    });

    it('보유종목 조회가 예외를 던져도 false 로 graceful 처리한다(비용 안전)', async () => {
      primeEnrichment();
      mockPrisma.position.count.mockRejectedValue(new Error('db down'));

      await expect(
        consumer.process(makeJob(JOB.EVENT_EXTRACTED, baseData)),
      ).resolves.toBeUndefined();

      const req = mockAiAnalystService.runSummary.mock.calls[0][0];
      expect(req.gate.isHolding).toBe(false);
    });

    it('보유종목 + 악재 polarity 가 게이트 입력으로 함께 전달된다(L3 활성 경로)', async () => {
      primeEnrichment();
      mockPrisma.position.count.mockResolvedValue(1);

      await consumer.process(
        makeJob(JOB.EVENT_EXTRACTED, {
          ...baseData,
          eventType: 'LAWSUIT',
          polarity: 'NEGATIVE',
        }),
      );

      const req = mockAiAnalystService.runSummary.mock.calls[0][0];
      expect(req.gate.isHolding).toBe(true);
      expect(req.gate.polarity).toBe('NEGATIVE');
    });
  });

  // ─── DAR-74: polarity Rule 폴백 (결측/비정상 보정) ──────────────────────
  describe('DAR-74 — polarity Rule 폴백', () => {
    function primeEnrichment() {
      mockPrisma.disclosureDocument.findUnique.mockResolvedValue({ rawText: '본문' });
      mockPrisma.disclosureEvent.findUnique.mockResolvedValue({ extractedData: {} });
      mockPrisma.stockDailyPrice.findFirst.mockResolvedValue({
        tradingValue: BigInt(5_000_000_000),
        tradeDate: '20240531',
      });
      mockAiAnalystService.runSummary.mockResolvedValue(null);
    }

    it('유효 polarity 는 그대로 통과시킨다', async () => {
      primeEnrichment();
      await consumer.process(
        makeJob(JOB.EVENT_EXTRACTED, { ...baseData, polarity: 'NEGATIVE' }),
      );
      const req = mockAiAnalystService.runSummary.mock.calls[0][0];
      expect(req.gate.polarity).toBe('NEGATIVE');
    });

    it('polarity 결측 + 악재 이벤트면 NEGATIVE 로 Rule 폴백한다', async () => {
      primeEnrichment();
      await consumer.process(
        makeJob(JOB.EVENT_EXTRACTED, {
          ...baseData,
          eventType: 'CONTRACT_CANCELLATION',
          polarity: undefined as unknown as string,
        }),
      );
      const req = mockAiAnalystService.runSummary.mock.calls[0][0];
      expect(req.gate.polarity).toBe('NEGATIVE');
    });

    it('polarity 비정상 값 + 비악재 이벤트면 NEUTRAL 로 보수 폴백한다', async () => {
      primeEnrichment();
      await consumer.process(
        makeJob(JOB.EVENT_EXTRACTED, {
          ...baseData,
          eventType: 'SUPPLY_CONTRACT',
          polarity: 'GARBAGE',
        }),
      );
      const req = mockAiAnalystService.runSummary.mock.calls[0][0];
      expect(req.gate.polarity).toBe('NEUTRAL');
    });
  });

  // ─── DAR-78: 전체 Task 오케스트레이션 (Summary→Persona→Thesis) ────────────
  describe('DAR-78 — AI 전체 Task 오케스트레이션', () => {
    function primeEnrichment() {
      mockPrisma.disclosureDocument.findUnique.mockResolvedValue({ rawText: '본문' });
      mockPrisma.disclosureEvent.findUnique.mockResolvedValue({ extractedData: {} });
      mockPrisma.stockDailyPrice.findFirst.mockResolvedValue({
        tradingValue: BigInt(5_000_000_000),
        tradeDate: '20240531',
      });
    }

    it('Summary 통과 시 Persona·Thesis까지 순차 오케스트레이션한다', async () => {
      primeEnrichment();
      mockAiAnalystService.runSummary.mockResolvedValue(summaryDraft);
      const personaViews = [{ persona: 'AGGRESSIVE', interpretation: '적극', fitScore: 80 }];
      mockAiAnalystService.runPersonaInterpretation.mockResolvedValue(personaViews);
      mockAiAnalystService.runPositionThesis.mockResolvedValue({
        initialThesis: 't',
        invalidConditions: [],
        riskNotes: 'r',
      });
      mockPrisma.tradingSignal.findFirst.mockResolvedValue({ id: 'SIG1', buyScore: 77 });

      await consumer.process(makeJob(JOB.EVENT_EXTRACTED, baseData));

      // Persona: Summary 산출물 + 4종 Persona 전달
      expect(mockAiAnalystService.runPersonaInterpretation).toHaveBeenCalledTimes(1);
      const pReq = mockAiAnalystService.runPersonaInterpretation.mock.calls[0][0];
      expect(pReq.input.summary).toEqual(summaryDraft);
      expect(pReq.input.personas).toEqual([
        'CONSERVATIVE',
        'BALANCED',
        'AGGRESSIVE',
        'EVENT_DRIVEN',
      ]);

      // Thesis: Persona 산출물 + TradingSignal 실조회값(signalId·buyScore) 전달
      expect(mockAiAnalystService.runPositionThesis).toHaveBeenCalledTimes(1);
      const tReq = mockAiAnalystService.runPositionThesis.mock.calls[0][0];
      expect(tReq.input.personaViews).toEqual(personaViews);
      expect(tReq.input.signalId).toBe('SIG1');
      expect(tReq.input.buyScore).toBe(77);
    });

    it('Summary가 L0로 스킵(null)되면 Persona·Thesis를 호출하지 않는다(비용 안전)', async () => {
      primeEnrichment();
      mockAiAnalystService.runSummary.mockResolvedValue(null);

      await consumer.process(makeJob(JOB.EVENT_EXTRACTED, baseData));

      expect(mockAiAnalystService.runPersonaInterpretation).not.toHaveBeenCalled();
      expect(mockAiAnalystService.runPositionThesis).not.toHaveBeenCalled();
    });

    it('TradingSignal 결측 시 합성 signalId·buyScore=0 으로 Thesis를 실행한다(graceful)', async () => {
      primeEnrichment();
      mockAiAnalystService.runSummary.mockResolvedValue(summaryDraft);
      mockAiAnalystService.runPersonaInterpretation.mockResolvedValue([]);
      mockPrisma.tradingSignal.findFirst.mockResolvedValue(null);

      await consumer.process(makeJob(JOB.EVENT_EXTRACTED, baseData));

      expect(mockPrisma.tradingSignal.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { rcpNo: '20240601000001' } }),
      );
      const tReq = mockAiAnalystService.runPositionThesis.mock.calls[0][0];
      expect(tReq.input.signalId).toBe('rcp:20240601000001');
      expect(tReq.input.buyScore).toBe(0);
    });

    it('Persona 실패는 graceful 처리하고 Thesis는 빈 personaViews로 진행한다', async () => {
      primeEnrichment();
      mockAiAnalystService.runSummary.mockResolvedValue(summaryDraft);
      mockAiAnalystService.runPersonaInterpretation.mockRejectedValue(new Error('LLM bad json'));

      await expect(
        consumer.process(makeJob(JOB.EVENT_EXTRACTED, baseData)),
      ).resolves.toBeUndefined();

      // Persona 실패가 파이프라인을 깨지 않고 Thesis는 계속 진행(빈 personaViews)
      expect(mockAiAnalystService.runPositionThesis).toHaveBeenCalledTimes(1);
      const tReq = mockAiAnalystService.runPositionThesis.mock.calls[0][0];
      expect(tReq.input.personaViews).toEqual([]);
    });

    it('Thesis 실패는 graceful 처리하고 잡을 정상 완료한다(Summary는 이미 영속)', async () => {
      primeEnrichment();
      mockAiAnalystService.runSummary.mockResolvedValue(summaryDraft);
      mockAiAnalystService.runPersonaInterpretation.mockResolvedValue([]);
      mockAiAnalystService.runPositionThesis.mockRejectedValue(new Error('LLM timeout'));

      await expect(
        consumer.process(makeJob(JOB.EVENT_EXTRACTED, baseData)),
      ).resolves.toBeUndefined();
    });

    it('동일 잡 재실행은 멱등이다 — runSummary 캐시 반환 경로에서도 오케스트레이션이 안전하다', async () => {
      primeEnrichment();
      // runSummary가 캐시된 draft를 반환해도(2회 호출) Persona/Thesis가 동일하게 호출된다.
      mockAiAnalystService.runSummary.mockResolvedValue(summaryDraft);
      mockAiAnalystService.runPersonaInterpretation.mockResolvedValue([]);

      await consumer.process(makeJob(JOB.EVENT_EXTRACTED, baseData));
      await consumer.process(makeJob(JOB.EVENT_EXTRACTED, baseData));

      expect(mockAiAnalystService.runSummary).toHaveBeenCalledTimes(2);
      expect(mockAiAnalystService.runPersonaInterpretation).toHaveBeenCalledTimes(2);
    });
  });
});
