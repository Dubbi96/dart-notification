import { AiUsageLogService } from './ai-usage-log.service';
import { InMemoryAiAnalysisRepository } from '../adapters/in-memory-ai-analysis.repository';
import { AiCostLevel } from '../types/ai-analyst.types';

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
