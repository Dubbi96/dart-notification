/**
 * GraduationController 스펙 (DAR-67)
 *
 * 회귀 가드:
 *  1) GET /graduation/metrics 가 getMetrics → 게이트 리포트로 매핑해 {success,data} 로 반환.
 *  2) 게스트 열람 가능해야 한다(OptionalJwtAuthGuard) — JwtAuthGuard 로 회귀 금지.
 *  3) GraduationModule 이 GraduationMetricsService + SIMULATION_PORT 를 실제로 배선(provider 등록).
 */
import { Test } from '@nestjs/testing';
import { GraduationController } from './graduation.controller';
import { GraduationMetricsService, GraduationMetrics } from './graduation-metrics.service';
import { GraduationModule } from './graduation.module';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { SIMULATION_PORT } from './ports/simulation.port';
import { PrismaService } from '../../prisma/prisma.service';

function sampleMetrics(): GraduationMetrics {
  return {
    portfolioId: 'pf-1',
    asOf: '2026-06-06T00:00:00.000Z',
    hitRate: { evaluated: 10, hits: 6, hitRatePct: 60 },
    cumulativeReturn: {
      initialCapital: 10_000_000,
      currentValue: 10_500_000,
      absolutePnl: 500_000,
      returnPct: 5,
    },
    aiCostEfficiency: {
      aiCostKrw: 50_000,
      netPnlKrw: 500_000,
      netPnlAfterAiCost: 450_000,
      aiCostToNetPnlRatio: 0.1,
    },
    exitAccuracy: { evaluated: 8, correct: 5, accuracyPct: 62.5 },
    riskAdjusted: { sharpe: 1.4, mddPct: -8, observations: 20, measurable: true },
    benchmarkAlpha: {
      indexCode: '0001',
      portfolioReturnPct: 5,
      benchmarkReturnPct: 2,
      alphaPct: 3,
      fromDate: '20260101',
      toDate: '20260601',
      measurable: true,
    },
    simulationProgress: {
      windowDays: 30,
      startDate: '2026-05-22T00:00:00.000Z',
      asOf: '2026-06-06T00:00:00.000Z',
      elapsedDays: 15,
      remainingDays: 15,
      progressRatio: 0.5,
      awaitingMeasurement: false,
      windowComplete: false,
    },
    config: { hitRateHorizonDays: 5, exitAccuracyHorizonDays: 3, usdKrwRate: 1350 },
  };
}

describe('GraduationController', () => {
  const metricsService = {
    getMetrics: jest.fn(),
  } as unknown as jest.Mocked<GraduationMetricsService>;

  let controller: GraduationController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new GraduationController(metricsService);
  });

  it('getMetrics 결과를 게이트 리포트로 매핑해 {success,data} 로 반환한다', async () => {
    (metricsService.getMetrics as jest.Mock).mockResolvedValue(sampleMetrics());
    const res = await controller.metrics();
    expect(metricsService.getMetrics).toHaveBeenCalledTimes(1);
    expect(res.success).toBe(true);
    expect(res.data.gates.map((g) => g.id)).toEqual(['G1', 'G2', 'G3', 'G5', 'G6', 'G7']);
    expect(res.data.allPassed).toBe(true);
    expect(res.data.lowSample).toBe(false);
  });

  it('컨트롤러 가드가 OptionalJwtAuthGuard 여야 한다(게스트 401 금지)', () => {
    const guards = Reflect.getMetadata('__guards__', GraduationController.prototype.metrics) as unknown[];
    expect(guards).toBeDefined();
    expect(guards).toContain(OptionalJwtAuthGuard);
  });
});

describe('GraduationModule 배선', () => {
  it('GraduationMetricsService 와 SIMULATION_PORT 를 provider 로 등록한다', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [GraduationModule],
    })
      .overrideProvider(PrismaService)
      .useValue({})
      .compile();

    const service = moduleRef.get(GraduationMetricsService);
    const port = moduleRef.get(SIMULATION_PORT);
    expect(service).toBeInstanceOf(GraduationMetricsService);
    expect(port).toBeDefined();
    // 컨트롤러도 해석되어야 한다(REST 노출 보장)
    const ctrl = moduleRef.get(GraduationController);
    expect(ctrl).toBeInstanceOf(GraduationController);
    await moduleRef.close();
  });
});
