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

  it('DAR-239: l0Ratio 분모는 행 수가 아닌 공시(게이트 평가) 수 — A001 다중 행 중복 미집계', async () => {
    // sampleRows: 공시 A001(summary+event 2행)·A002·A003 = 비L0 공시 3건 + L0 공시 6건(B000~B005).
    // 행 수 분모(10)는 A001 중복으로 L0 비율을 6/10=60%로 축소 왜곡한다.
    // 공시 수 분모(9)가 실제 게이트 분포 → 6/9≈66.7%.
    const svc = makeService([...sampleRows, ...l0Rows]);
    const result = await svc.getPeriodSummary(new Date(), new Date());
    expect(result.l0Ratio).toBeCloseTo(6 / 9, 4);
    expect(result.l0Count).toBe(6);
  });

  it('DAR-239: L0 게이트 결정이 기록되면 l0Ratio가 게이트 분포를 반영(미기록 시 구조적 0)', async () => {
    // 회귀게이트 거짓발화의 핵심: L0 행이 0이면 l0Ratio=0/공시수=0(threshold 0.7 상시 위반).
    const noL0 = makeService([...sampleRows]); // L0 행 없음(버그 재현)
    expect((await noL0.getPeriodSummary(new Date(), new Date())).l0Ratio).toBe(0);

    // L0 7건 + 비L0 공시 3건 = 공시 10건 중 L0 7건 → 정확히 0.7.
    const sevenL0 = Array.from({ length: 7 }, (_, i) => ({
      task: 'summary', level: 'L0', costUsd: 0, inputTokens: 0, outputTokens: 0, rcpNo: `C0${i}`,
    }));
    const withL0 = makeService([...sampleRows, ...sevenL0]);
    expect((await withL0.getPeriodSummary(new Date(), new Date())).l0Ratio).toBeCloseTo(0.7, 6);
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
