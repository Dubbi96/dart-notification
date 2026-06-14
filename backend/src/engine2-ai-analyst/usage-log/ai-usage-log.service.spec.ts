import { AiUsageLogService } from './ai-usage-log.service';
import { InMemoryAiAnalysisRepository } from '../adapters/in-memory-ai-analysis.repository';
import { AiCostLevel } from '../types/ai-analyst.types';
import { AiAnalysisRepository } from '../ports/ai-analysis.repository';

/**
 * DAR-241: 멱등 캐시히트(비용0 재사용)가 비용 관측성에 노출되는지 검증한다.
 * 핵심 회귀 잠금:
 *   - 캐시히트는 cacheHitCount 로만 집계되고 callCount/l0Ratio/비용 분모를 오염시키지 않는다.
 *   - 실호출(logUsage)과 캐시히트(logCacheHit)는 분리 경로다.
 */
describe('AiUsageLogService — DAR-241 캐시히트 관측', () => {
  const FROM = new Date('2026-06-01T00:00:00.000Z');
  const TO = new Date('2026-06-30T23:59:59.999Z');

  function build() {
    const repo = new InMemoryAiAnalysisRepository();
    const service = new AiUsageLogService(repo);
    return { repo, service };
  }

  it('캐시히트 0건: cacheHitCount=0, 실호출 지표만 집계', async () => {
    const { service } = build();
    await service.logUsage({
      rcpNo: 'R001',
      task: 'summary',
      level: AiCostLevel.L2,
      model: 'gpt-4o-mini',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.001,
    });

    const metrics = await service.getCostMetrics(FROM, TO);
    expect(metrics.cacheHitCount).toBe(0);
    expect(metrics.callCount).toBe(1);
    expect(metrics.totalCostUsd).toBeCloseTo(0.001, 6);
  });

  it('캐시히트는 cacheHitCount에만 반영 — callCount/l0Ratio/비용 분모 무오염', async () => {
    const { service } = build();
    // 실호출 1건(L2, 유료).
    await service.logUsage({
      rcpNo: 'R001',
      task: 'summary',
      level: AiCostLevel.L2,
      model: 'gpt-4o-mini',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.002,
    });
    // 같은 공시 재처리 → 캐시히트 3회(BullMQ 재시도/중복 모사).
    await service.logCacheHit({ rcpNo: 'R001', task: 'summary', level: AiCostLevel.L2 });
    await service.logCacheHit({ rcpNo: 'R001', task: 'summary', level: AiCostLevel.L2 });
    await service.logCacheHit({ rcpNo: 'R001', task: 'summary', level: AiCostLevel.L2 });

    const metrics = await service.getCostMetrics(FROM, TO);
    expect(metrics.cacheHitCount).toBe(3); // 적중률 관측 노출
    expect(metrics.callCount).toBe(1); // 호출 수는 실호출 1건 그대로(부풀지 않음)
    expect(metrics.totalCostUsd).toBeCloseTo(0.002, 6); // 비용 분모 불변
    expect(metrics.l0Ratio).toBe(0); // 실호출 1건이 L2 → l0Ratio 캐시히트 영향 없음
  });

  it('기간 밖 캐시히트는 집계에서 제외', async () => {
    const { repo, service } = build();
    await repo.saveCacheHit({
      rcpNo: 'R002',
      task: 'summary',
      level: AiCostLevel.L2,
      createdAt: new Date('2026-05-01T00:00:00.000Z'), // 윈도우 이전
    });
    const metrics = await service.getCostMetrics(FROM, TO);
    expect(metrics.cacheHitCount).toBe(0);
  });
});

/**
 * DAR-239: l0Ratio가 'AIUsageLog 행' 분모가 아니라 '게이트 평가(=공시) 수' 분모로 산출돼
 * 실제 게이트 분포를 반영하는지 검증. L0 행 미기록 시 분자 구조적 0(회귀 게이트 거짓발화) 회귀 방지.
 */
describe('AiUsageLogService.getCostMetrics — l0Ratio (DAR-239)', () => {
  function makeService(rows: any[]) {
    const repo = {
      getUsageSummary: jest.fn().mockResolvedValue(rows),
      getCacheHitCount: jest.fn().mockResolvedValue(0),
      saveUsage: jest.fn(),
      saveCacheHit: jest.fn(),
      findAnalysis: jest.fn(),
      saveAnalysis: jest.fn(),
    } as unknown as AiAnalysisRepository;
    return new AiUsageLogService(repo);
  }

  it('L0 행이 없으면(버그 재현) l0Ratio=0 — 회귀 게이트 상시 거짓발화', async () => {
    const rows = [
      { task: 'summary', level: 'L2', costUsd: 0.002, inputTokens: 200, outputTokens: 80, rcpNo: 'A001' },
      { task: 'persona_interpretation', level: 'L2', costUsd: 0.003, inputTokens: 300, outputTokens: 120, rcpNo: 'A001' },
    ];
    const m = await makeService(rows).getCostMetrics(new Date(), new Date());
    expect(m.l0Ratio).toBe(0);
    expect(m.l0Warning).toBe(true);
  });

  it('L0 게이트 결정이 기록되면 l0Ratio가 공시 단위 분포를 반영(행 다중성에 불변)', async () => {
    // 비L0 공시 A001(2행: summary+persona) + L0 공시 7건 = 공시 8건 중 L0 7건 → 0.875.
    const l0 = Array.from({ length: 7 }, (_, i) => ({
      task: 'summary', level: 'L0', costUsd: 0, inputTokens: 0, outputTokens: 0, rcpNo: `B0${i}`,
    }));
    const rows = [
      { task: 'summary', level: 'L2', costUsd: 0.002, inputTokens: 200, outputTokens: 80, rcpNo: 'A001' },
      { task: 'persona_interpretation', level: 'L2', costUsd: 0.003, inputTokens: 300, outputTokens: 120, rcpNo: 'A001' },
      ...l0,
    ];
    const m = await makeService(rows).getCostMetrics(new Date(), new Date());
    expect(m.l0Ratio).toBeCloseTo(7 / 8, 6); // 행 분모(9)였다면 7/9로 왜곡
    expect(m.l0Warning).toBe(false); // 0.875 ≥ 0.7
    // 비용/공시 분모도 공시 단위 — L0(무비용) 공시 포함.
    expect(m.costPerDisclosure).toBeCloseTo(0.005 / 8, 6);
  });

  it('표본 0건: l0Ratio=1 (graceful)', async () => {
    const m = await makeService([]).getCostMetrics(new Date(), new Date());
    expect(m.l0Ratio).toBe(1);
    expect(m.l0Warning).toBe(false);
  });
});
