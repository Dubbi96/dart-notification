import { PriceMoveReasoningService } from './price-move-reasoning.service';
import { AiCostLevel } from '../types/ai-analyst.types';
import { PriceMoveReasonJobData } from '../../common/queues/queue.constants';

const NOW = new Date('2026-07-17T05:00:00Z');

const event: PriceMoveReasonJobData = {
  refId: '005930-20260717',
  corpCode: '00126380',
  stockCode: '005930',
  corpName: '삼성전자',
  tradeDate: '20260717',
  changePct: 6.3,
};

function statsResp(rcpNo: string) {
  return {
    rcpNo,
    minSampleSize: 30,
    generatedAt: NOW.toISOString(),
    results: [
      {
        eventType: 'SUPPLY_CONTRACT',
        sampleCount: 42,
        stats: {
          d1: { avgReturn: 2.1, avgAbnormalReturn: 1.7, winRate: 0.62 },
          d5: { avgReturn: 3.4, avgAbnormalReturn: 2.9, winRate: 0.58 },
          d20: { avgReturn: 1.2, avgAbnormalReturn: 0.4, winRate: 0.51 },
        },
        reason: null,
        period: null,
        calculatedAt: null,
      },
    ],
  };
}

interface Mocks {
  prisma: any;
  gate: any;
  limitGuard: any;
  usageLog: any;
  reactionStats: any;
  task: any;
  repo: any;
  config: any;
  settle: jest.Mock;
}

function build(overrides: Partial<Record<keyof Mocks, any>> = {}): {
  service: PriceMoveReasoningService;
  m: Mocks;
} {
  const settle = jest.fn();
  const m: Mocks = {
    prisma: {
      disclosure: { findFirst: jest.fn().mockResolvedValue(null) },
      disclosureEvent: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ eventType: 'SUPPLY_CONTRACT', extractedData: { contractAmount: 123_000_000_000 } }),
      },
      disclosureDocument: { findUnique: jest.fn().mockResolvedValue({ rawText: '공급계약 체결' }) },
      aIUsageLog: { aggregate: jest.fn().mockResolvedValue({ _sum: { costUsd: 0 } }) },
      // DAR-528 — 재무 맥락 분모(연간 매출). 기본: 2025 연매출 1조.
      companyFinancial: {
        findFirst: jest.fn().mockResolvedValue({ revenue: BigInt('1000000000000'), bsnsYear: '2025' }),
      },
    },
    gate: { evaluateGate: jest.fn().mockReturnValue(AiCostLevel.L2) },
    limitGuard: { enforceLimit: jest.fn().mockResolvedValue({ level: AiCostLevel.L2, settle }) },
    usageLog: { logUsage: jest.fn().mockResolvedValue(undefined) },
    reactionStats: { getReactionStatsByRcpNo: jest.fn().mockResolvedValue(statsResp('20260717000001')) },
    task: {
      run: jest.fn().mockResolvedValue({
        result: {
          cause: '공급계약 체결이 상승을 견인.',
          evidence: ['공급계약 공시', '유사공시 D+5 +2.9%(n=42)'],
          eventLinkage: 'STRONG',
          caveat: '과거 평균이며 보장 아님.',
        },
        usage: { model: 'gpt-4o-mini', inputTokens: 120, outputTokens: 60 },
      }),
    },
    repo: { find: jest.fn().mockResolvedValue(null), save: jest.fn().mockResolvedValue(undefined) },
    config: { get: jest.fn().mockReturnValue(undefined) }, // → 기본 상한 $0.5
    settle,
  };
  Object.assign(m, overrides);
  const service = new PriceMoveReasoningService(
    m.prisma,
    m.gate,
    m.limitGuard,
    m.usageLog,
    m.reactionStats,
    m.task,
    m.repo,
    m.config,
  );
  return { service, m };
}

describe('PriceMoveReasoningService (DAR-522)', () => {
  it('수용기준1 — 무공시(48h)면 AI 호출 0 + "관련 공시 없음(48h)" 포맷 응답(분석 위장 금지)', async () => {
    const { service, m } = build();
    m.prisma.disclosure.findFirst.mockResolvedValue(null);

    const rec = await service.reason(event, NOW);

    expect(rec.status).toBe('NO_DISCLOSURE');
    expect(rec.rcpNo).toBeNull();
    expect((rec.resultJson as any).label).toBe('관련 공시 없음(48h)');
    // ★AI 호출 0 — 게이트·태스크·사용량로그 어느 것도 호출되지 않는다.
    expect(m.gate.evaluateGate).not.toHaveBeenCalled();
    expect(m.task.run).not.toHaveBeenCalled();
    expect(m.usageLog.logUsage).not.toHaveBeenCalled();
    expect(m.repo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'NO_DISCLOSURE' }));
  });

  it('멱등 — 이미 처리한 등락 이벤트면 캐시 반환, AI·공시조회 없음', async () => {
    const { service, m } = build();
    const cached = { refId: event.refId, status: 'ANALYZED' } as any;
    m.repo.find.mockResolvedValue(cached);

    const rec = await service.reason(event, NOW);

    expect(rec).toBe(cached);
    expect(m.prisma.disclosure.findFirst).not.toHaveBeenCalled();
    expect(m.task.run).not.toHaveBeenCalled();
  });

  it('공시 존재 — 비용게이트 통과 시 AI 원인 해석 + AIUsageLog 기록(누락 0) + refId 저장', async () => {
    const { service, m } = build();
    m.prisma.disclosure.findFirst.mockResolvedValue({
      rcpNo: '20260717000001',
      reportName: '단일판매·공급계약체결',
    });

    const rec = await service.reason(event, NOW);

    expect(m.task.run).toHaveBeenCalledTimes(1);
    // EventStudy 유사사례 통계가 프롬프트 입력으로 주입된다.
    expect(m.task.run.mock.calls[0][0].reactionStats).toMatchObject({ sampleCount: 42 });
    // AIUsageLog 누락 0 — 역방향 리즈닝 태스크명·레벨로 기록.
    expect(m.usageLog.logUsage).toHaveBeenCalledWith(
      expect.objectContaining({ task: 'price-move-reasoning', level: AiCostLevel.L2, rcpNo: '20260717000001' }),
    );
    expect(rec.status).toBe('ANALYZED');
    expect((rec.resultJson as any).eventLinkage).toBe('STRONG');
    // DAR-528 — 재무 맥락 한 줄(계약 규모 123,000,000,000 / 연매출 1조 = 12.3%).
    expect((rec.resultJson as any).financialContext).toBe(
      '이번 계약 규모는 2025 연매출의 약 12.3% (1230억 / 연매출 1조)',
    );
    expect(m.repo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'ANALYZED', rcpNo: '20260717000001' }));
    expect(m.settle).toHaveBeenCalled();
  });

  describe('DAR-528 — 재무 맥락 한 줄(CompanyFinancial 주입)', () => {
    it('★수용기준 — 연매출(분모) 결측이면 financialContext=null(표시 생략), AI 비용 증가 0', async () => {
      const { service, m } = build();
      m.prisma.disclosure.findFirst.mockResolvedValue({ rcpNo: '20260717000001', reportName: '공급계약' });
      m.prisma.companyFinancial.findFirst.mockResolvedValue(null); // 연간 재무 없음 → 분모 불확실

      const rec = await service.reason(event, NOW);

      expect(rec.status).toBe('ANALYZED');
      expect((rec.resultJson as any).financialContext).toBeNull();
      // ★AI 비용 증가 0 — 재무 맥락은 순수 DB 읽기 + 순수 함수. AI 태스크는 정확히 1회(재무맥락 무영향).
      expect(m.task.run).toHaveBeenCalledTimes(1);
      expect(m.usageLog.logUsage).toHaveBeenCalledTimes(1);
    });

    it('분자(계약금액) 결측이면 financialContext=null (분모 충분해도 수치 발명 금지)', async () => {
      const { service, m } = build();
      m.prisma.disclosure.findFirst.mockResolvedValue({ rcpNo: '20260717000001', reportName: '공급계약' });
      m.prisma.disclosureEvent.findUnique.mockResolvedValue({
        eventType: 'SUPPLY_CONTRACT',
        extractedData: { contractAmount: null },
      });

      const rec = await service.reason(event, NOW);

      expect((rec.resultJson as any).financialContext).toBeNull();
    });

    it('연간 재무 조회는 reprtCode=11011(연간)로 한정한다(분기/반기 누적치 배제)', async () => {
      const { service, m } = build();
      m.prisma.disclosure.findFirst.mockResolvedValue({ rcpNo: '20260717000001', reportName: '공급계약' });

      await service.reason(event, NOW);

      expect(m.prisma.companyFinancial.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ reprtCode: '11011' }) }),
      );
    });
  });

  it('수용기준2 — 일일 비용 상한(env) 초과면 AI 호출 0(CAP_SKIPPED)', async () => {
    const { service, m } = build({ config: { get: jest.fn().mockReturnValue('0.2') } });
    m.prisma.disclosure.findFirst.mockResolvedValue({ rcpNo: '20260717000001', reportName: 'x' });
    m.prisma.aIUsageLog.aggregate.mockResolvedValue({ _sum: { costUsd: 0.25 } }); // 0.25 ≥ 0.2

    const rec = await service.reason(event, NOW);

    expect(rec.status).toBe('CAP_SKIPPED');
    expect(m.gate.evaluateGate).not.toHaveBeenCalled();
    expect(m.task.run).not.toHaveBeenCalled();
    expect(m.usageLog.logUsage).not.toHaveBeenCalled();
  });

  it('전역 한도 강등(L0)이면 AI 호출 0(CAP_SKIPPED) + 예약 해제', async () => {
    const { service, m } = build();
    m.prisma.disclosure.findFirst.mockResolvedValue({ rcpNo: '20260717000001', reportName: 'x' });
    m.limitGuard.enforceLimit.mockResolvedValue({ level: AiCostLevel.L0, settle: m.settle });

    const rec = await service.reason(event, NOW);

    expect(rec.status).toBe('CAP_SKIPPED');
    expect(m.task.run).not.toHaveBeenCalled();
    expect(m.usageLog.logUsage).not.toHaveBeenCalled();
    expect(m.settle).toHaveBeenCalled();
  });
});
