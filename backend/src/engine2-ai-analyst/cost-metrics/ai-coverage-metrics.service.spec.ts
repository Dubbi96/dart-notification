import {
  AiCoverageMetricsService,
  percentile,
} from './ai-coverage-metrics.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * W10 — AI 커버리지 계기판 집계 로직.
 * 대상 공시(이벤트 추출 완료·라이브) 대비 분석 생성률(%)과
 * 공시수신(Disclosure.createdAt)→분석생성(최초 DisclosureAnalysis.createdAt) P50/P95 지연 검증.
 */
describe('AiCoverageMetricsService (W10)', () => {
  const NOW = new Date('2026-07-16T09:00:00.000Z');

  /** row 헬퍼 — receivedAt에 수신된 대상 공시, latencySec 후 분석 생성(null=미생성). */
  function row(receivedAt: Date, latencySec: number | null) {
    return {
      createdAt: receivedAt,
      disclosureAnalyses:
        latencySec === null
          ? []
          : [{ createdAt: new Date(receivedAt.getTime() + latencySec * 1000) }],
    };
  }

  function makeService(rows: ReturnType<typeof row>[]) {
    const findMany = jest.fn().mockResolvedValue(rows);
    const prisma = { disclosure: { findMany } } as unknown as PrismaService;
    return { svc: new AiCoverageMetricsService(prisma), findMany };
  }

  it('대상 공시 필터 — 최근 N일 수신 + 이벤트 존재 + isBackfill=false 조건으로 조회한다', async () => {
    const { svc, findMany } = makeService([]);
    await svc.getCoverage(NOW, 7);

    const args = findMany.mock.calls[0][0];
    expect(args.where.isBackfill).toBe(false);
    expect(args.where.disclosureEvent).toEqual({ isNot: null });
    expect(args.where.createdAt.lte).toEqual(NOW);
    // 7일 창: from = now - 7d
    expect(args.where.createdAt.gte).toEqual(new Date('2026-07-09T09:00:00.000Z'));
    // 지연 기준은 최초 분석 1건
    expect(args.select.disclosureAnalyses.take).toBe(1);
    expect(args.select.disclosureAnalyses.orderBy).toEqual({ createdAt: 'asc' });
  });

  it('생성률(%) — 대상 4건 중 3건 분석 생성이면 75%', async () => {
    const base = new Date('2026-07-15T00:00:00.000Z');
    const { svc } = makeService([
      row(base, 60),
      row(base, 120),
      row(base, null), // 미생성(대기)
      row(base, 30),
    ]);
    const snap = await svc.getCoverage(NOW, 7);

    expect(snap.targetCount).toBe(4);
    expect(snap.analyzedCount).toBe(3);
    expect(snap.coverageRatePct).toBe(75);
    expect(snap.latency.sampleCount).toBe(3);
  });

  it('P50/P95 지연 — nearest-rank 분위수(초)', async () => {
    const base = new Date('2026-07-15T00:00:00.000Z');
    // 지연 표본: 10, 20, 30, 40 → P50=2번째(20초), P95=ceil(0.95×4)=4번째(40초)
    const { svc } = makeService([row(base, 10), row(base, 20), row(base, 30), row(base, 40)]);
    const snap = await svc.getCoverage(NOW, 7);

    expect(snap.latency.p50Sec).toBe(20);
    expect(snap.latency.p95Sec).toBe(40);
  });

  it('시계 오차 음수 지연은 0으로 클램프한다', async () => {
    const base = new Date('2026-07-15T00:00:00.000Z');
    const { svc } = makeService([row(base, -5)]);
    const snap = await svc.getCoverage(NOW, 7);
    expect(snap.latency.p50Sec).toBe(0);
  });

  it('대상 0건 graceful — 생성률 100%, 지연 null·표본 0', async () => {
    const { svc } = makeService([]);
    const snap = await svc.getCoverage(NOW, 7);

    expect(snap.targetCount).toBe(0);
    expect(snap.coverageRatePct).toBe(100);
    expect(snap.latency).toEqual({ p50Sec: null, p95Sec: null, sampleCount: 0 });
  });

  it('스냅샷 메타 — windowDays·from·to 반영', async () => {
    const { svc } = makeService([]);
    const snap = await svc.getCoverage(NOW, 3);
    expect(snap.windowDays).toBe(3);
    expect(snap.from).toBe('2026-07-13T09:00:00.000Z');
    expect(snap.to).toBe(NOW.toISOString());
  });

  describe('clampWindowDays — 조회창 정규화', () => {
    it('비수치·0 이하는 기본 7일', () => {
      expect(AiCoverageMetricsService.clampWindowDays(NaN)).toBe(7);
      expect(AiCoverageMetricsService.clampWindowDays(0)).toBe(7);
      expect(AiCoverageMetricsService.clampWindowDays(-3)).toBe(7);
    });

    it('상한 90일 클램프·소수 내림', () => {
      expect(AiCoverageMetricsService.clampWindowDays(365)).toBe(90);
      expect(AiCoverageMetricsService.clampWindowDays(7.9)).toBe(7);
      expect(AiCoverageMetricsService.clampWindowDays(30)).toBe(30);
    });
  });

  describe('percentile — nearest-rank', () => {
    it('빈 표본은 null', () => {
      expect(percentile([], 0.5)).toBeNull();
    });

    it('단일 표본은 모든 분위수에서 그 값', () => {
      expect(percentile([42], 0.5)).toBe(42);
      expect(percentile([42], 0.95)).toBe(42);
    });

    it('정렬되지 않은 입력도 정렬 후 계산하며 소수 2자리 반올림', () => {
      expect(percentile([3.333, 1.111, 2.222], 0.5)).toBe(2.22);
      expect(percentile([30, 10, 20], 0.95)).toBe(30);
    });
  });
});
