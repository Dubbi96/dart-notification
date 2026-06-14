import { AiCostAggregationService } from './ai-cost-aggregation.service';
import { AiAnalysisRepository } from '../ports/ai-analysis.repository';
import { PrismaService } from '../../prisma/prisma.service';

describe('AiCostAggregationService', () => {
  function makeService(rows: any[], cacheHitCount = 0) {
    const mockRepo = {
      getUsageSummary: jest.fn().mockResolvedValue(rows),
      getCacheHitCount: jest.fn().mockResolvedValue(cacheHitCount),
      findAnalysis: jest.fn(),
      saveAnalysis: jest.fn(),
      saveUsage: jest.fn(),
      saveCacheHit: jest.fn(),
    } as unknown as AiAnalysisRepository;

    const mockPrisma = {
      tradingSignal: { count: jest.fn().mockResolvedValue(10) },
      paperTrade: { count: jest.fn().mockResolvedValue(3) },
    } as unknown as PrismaService;

    return new AiCostAggregationService(mockRepo, mockPrisma);
  }

  const sampleRows = [
    { task: 'summary', level: 'L2', costUsd: 0.001, inputTokens: 100, outputTokens: 50, rcpNo: 'A001' },
    { task: 'summary', level: 'L2', costUsd: 0.002, inputTokens: 200, outputTokens: 80, rcpNo: 'A002' },
    { task: 'event_classification', level: 'L1', costUsd: 0.0005, inputTokens: 50, outputTokens: 20, rcpNo: 'A001' },
    { task: 'position_thesis', level: 'L3', costUsd: 0.005, inputTokens: 500, outputTokens: 200, rcpNo: 'A003' },
  ];

  const l0Rows = Array.from({ length: 6 }, (_, i) => ({
    task: 'summary', level: 'L0', costUsd: 0, inputTokens: 0, outputTokens: 0, rcpNo: `B00${i}`,
  }));

  it('집계 정확도: totalCostUsd, callCount, 토큰 합산', async () => {
    const svc = makeService(sampleRows);
    const result = await svc.getPeriodSummary(new Date('2026-01-01'), new Date('2026-12-31'));
    expect(result.callCount).toBe(4);
    expect(result.totalCostUsd).toBeCloseTo(0.0085, 6);
    expect(result.totalInputTokens).toBe(850);
    expect(result.totalOutputTokens).toBe(350);
  });

  it('레벨별 분류 정확도', async () => {
    const svc = makeService(sampleRows);
    const result = await svc.getPeriodSummary(new Date(), new Date());
    expect(result.l1Count).toBe(1);
    expect(result.l2Count).toBe(2);
    expect(result.l3Count).toBe(1);
    expect(result.l0Count).toBe(0);
  });

  it('task별 분류 정확도', async () => {
    const svc = makeService(sampleRows);
    const result = await svc.getPeriodSummary(new Date(), new Date());
    expect(result.byTask['summary'].callCount).toBe(2);
    expect(result.byTask['event-classification'].callCount).toBe(1);
    expect(result.byTask['position-thesis'].callCount).toBe(1);
  });

  it('L0 비율 계산: L0 6건 포함 시 60% L0', async () => {
    const svc = makeService([...sampleRows, ...l0Rows]);
    const result = await svc.getPeriodSummary(new Date(), new Date());
    expect(result.l0Ratio).toBeCloseTo(6 / 10, 4);
  });

  it('빈 데이터: l0Ratio=1, totalCostUsd=0', async () => {
    const svc = makeService([]);
    const result = await svc.getPeriodSummary(new Date(), new Date());
    expect(result.l0Ratio).toBe(1);
    expect(result.totalCostUsd).toBe(0);
    expect(result.callCount).toBe(0);
  });

  it('DAR-241: 캐시히트는 실호출 집계와 분리 — callCount/l0Ratio 불변, cacheHitCount만 별도 노출', async () => {
    // 실호출 4건 + 캐시히트 7건. cacheHit 행은 getUsageSummary(rows)에 포함되지 않으므로
    // callCount/비용/l0Ratio 분모는 실호출 4건 기준 그대로다(무오염).
    const svc = makeService(sampleRows, 7);
    const result = await svc.getPeriodSummary(new Date(), new Date());
    expect(result.cacheHitCount).toBe(7);
    expect(result.callCount).toBe(4); // 캐시히트가 호출 수를 부풀리지 않음
    expect(result.totalCostUsd).toBeCloseTo(0.0085, 6); // 비용 분모 불변
  });
});
