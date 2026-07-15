import { Test, TestingModule } from '@nestjs/testing';
import { SignalGrade } from '@prisma/client';
import { SignalsService } from './signals.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * W13 '근거 지표 펼치기': 신호 상세(findOne)에 스코어링이 소비한 TechnicalIndicator 원시 수치를
 * read-only 로 동봉하는 evidenceIndicators 매핑 검증.
 * - as-of 규칙: 신호 생성 KST 거래일 이하(lte) 최신(tradeDate desc) 행 — 스코어링
 *   loadStockContextAsOf 와 동일 규칙(point-in-time 근사, 미래 지표 미참조).
 * - nullable 필드 그대로 통과(계산·보정 금지 — 모바일 '—' 처리).
 * - 지표 미적재·조회 실패 → null(상세 서빙을 막지 않는 graceful).
 */
describe('SignalsService.findOne — evidenceIndicators (W13)', () => {
  let service: SignalsService;
  let prisma: {
    tradingSignal: { findUnique: jest.Mock };
    eventStudyResult: { findMany: jest.Mock };
    technicalIndicator: { findFirst: jest.Mock };
  };

  // 2026-07-14T23:30:00Z = 2026-07-15 08:30 KST → as-of 거래일 20260715
  const CREATED_AT = new Date('2026-07-14T23:30:00.000Z');

  const baseSignal = {
    id: 'sig_1',
    rcpNo: '20260714000001',
    corpCode: '00126380',
    stockCode: '005930',
    eventType: 'SUPPLY_CONTRACT',
    persona: 'GROWTH',
    buyScore: 72,
    signal: SignalGrade.BUY_CANDIDATE,
    scoreBreakdown: { disclosureEvent: 20 },
    riskPenalty: 0,
    entryConditionMet: [],
    entryConditionUnmet: [],
    entryReady: true,
    riskFactors: [],
    signalSummary: null,
    blockedReason: null,
    suppressionReason: null,
    validUntil: null,
    isNotified: false,
    notifiedAt: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    company: { corpCode: '00126380', corpName: '삼성전자', stockCode: '005930' },
  };

  const tiRow = {
    tradeDate: '20260714',
    ma5: 71200,
    ma20: 70100,
    ma60: 68000,
    rsi14: 61.3,
    macdLine: 250.1,
    macdSignal: 180.4,
    bollingerMid: 70100,
    volumeRatio20: 2.4,
    preDsclReturn: 3.1,
  };

  beforeEach(async () => {
    prisma = {
      tradingSignal: { findUnique: jest.fn() },
      eventStudyResult: { findMany: jest.fn().mockResolvedValue([]) },
      technicalIndicator: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [SignalsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<SignalsService>(SignalsService);
  });

  it('스코어링 소비 원시 수치(rsi14·volumeRatio20·preDsclReturn 등)와 기준 tradeDate 를 그대로 매핑한다', async () => {
    prisma.tradingSignal.findUnique.mockResolvedValue(baseSignal);
    prisma.technicalIndicator.findFirst.mockResolvedValue(tiRow);

    const result = await service.findOne('sig_1');

    expect(result.evidenceIndicators).toEqual({
      tradeDate: '20260714',
      ma5: 71200,
      ma20: 70100,
      ma60: 68000,
      rsi14: 61.3,
      macdLine: 250.1,
      macdSignal: 180.4,
      bollingerMid: 70100,
      volumeRatio20: 2.4,
      preDsclReturn: 3.1,
    });
  });

  it('as-of 조회: 생성시각의 KST 거래일 이하(lte)·최신(desc) 규칙 — 미래 지표 미참조', async () => {
    prisma.tradingSignal.findUnique.mockResolvedValue(baseSignal);
    prisma.technicalIndicator.findFirst.mockResolvedValue(tiRow);

    await service.findOne('sig_1');

    expect(prisma.technicalIndicator.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        // 2026-07-14T23:30Z = 07-15 08:30 KST → 상한 20260715 (UTC 날짜 아님 — KST 환산 검증)
        where: { stockCode: '005930', tradeDate: { lte: '20260715' } },
        orderBy: { tradeDate: 'desc' },
      }),
    );
  });

  it('nullable 필드는 null 그대로 통과한다(빈 값 계산·보정 금지 — 모바일 — 처리)', async () => {
    prisma.tradingSignal.findUnique.mockResolvedValue(baseSignal);
    prisma.technicalIndicator.findFirst.mockResolvedValue({
      ...tiRow,
      rsi14: null,
      preDsclReturn: null,
    });

    const result = await service.findOne('sig_1');

    expect(result.evidenceIndicators?.rsi14).toBeNull();
    expect(result.evidenceIndicators?.preDsclReturn).toBeNull();
    expect(result.evidenceIndicators?.volumeRatio20).toBe(2.4);
  });

  it('지표 미적재 종목이면 evidenceIndicators=null (상세는 정상 서빙)', async () => {
    prisma.tradingSignal.findUnique.mockResolvedValue(baseSignal);
    prisma.technicalIndicator.findFirst.mockResolvedValue(null);

    const result = await service.findOne('sig_1');

    expect(result.evidenceIndicators).toBeNull();
    expect(result.id).toBe('sig_1');
    expect(result.buyScore).toBe(72);
  });

  it('지표 조회 실패(DB 오류)도 null 로 흡수한다 — 보조 표면이 상세를 막지 않는다', async () => {
    prisma.tradingSignal.findUnique.mockResolvedValue(baseSignal);
    prisma.technicalIndicator.findFirst.mockRejectedValue(new Error('db down'));

    const result = await service.findOne('sig_1');

    expect(result.evidenceIndicators).toBeNull();
    expect(result.id).toBe('sig_1');
  });

  it('company.stockCode 부재 시 역정규화 stockCode 로 폴백해 조회한다', async () => {
    prisma.tradingSignal.findUnique.mockResolvedValue({
      ...baseSignal,
      company: { corpCode: '00126380', corpName: '삼성전자', stockCode: null },
    });
    prisma.technicalIndicator.findFirst.mockResolvedValue(tiRow);

    await service.findOne('sig_1');

    expect(prisma.technicalIndicator.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ stockCode: '005930' }),
      }),
    );
  });
});
