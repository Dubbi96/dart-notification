import { PortfolioService } from './portfolio.service';

// DAR-163: 최신 포트폴리오 리스크 스냅샷 읽기 경로 단위 검증.
// Prisma 델리게이트를 목으로 대체 — 외부호출·하드룰 산출(Engine5)·AI 개입 없음(읽기 전용).
describe('PortfolioService.findLatestRiskSnapshot', () => {
  function makePrisma(portfolio: unknown) {
    return {
      portfolio: { findFirst: jest.fn().mockResolvedValue(portfolio) },
    } as any;
  }

  const baseSnapshot = {
    snapshotDate: '2026-06-12',
    totalValue: 12_000_000,
    cashAmount: 2_000_000,
    unrealizedPnl: 500_000,
    unrealizedPnlPct: 4.35,
    topPositionPct: 32.5,
    topSectorPct: 48.0,
    openPositionCount: 5,
    dailyPnl: -120_000,
    dailyPnlPct: -0.98,
    weeklyPnl: 300_000,
    weeklyPnlPct: 2.6,
    riskLevel: 'WARNING',
    hardRuleBreached: true,
    hardRuleDetail: '일일 손실 한도 근접',
  };

  it('활성 포트폴리오의 최신 스냅샷을 화면 형태로 반환한다', async () => {
    const service = new PortfolioService(
      makePrisma({ id: 'pf-1', riskSnapshots: [baseSnapshot] }),
    );

    const result = await service.findLatestRiskSnapshot('user-1');

    expect(result).toEqual({
      portfolioId: 'pf-1',
      snapshotDate: '2026-06-12',
      totalValue: 12_000_000,
      cashAmount: 2_000_000,
      unrealizedPnl: 500_000,
      unrealizedPnlPct: 4.35,
      topPositionPct: 32.5,
      topSectorPct: 48.0,
      openPositionCount: 5,
      dailyPnl: -120_000,
      dailyPnlPct: -0.98,
      weeklyPnl: 300_000,
      weeklyPnlPct: 2.6,
      riskLevel: 'WARNING',
      hardRuleBreached: true,
      hardRuleDetail: '일일 손실 한도 근접',
    });
  });

  it('활성 포트폴리오가 없으면 null(빈상태)', async () => {
    const service = new PortfolioService(makePrisma(null));
    expect(await service.findLatestRiskSnapshot('user-1')).toBeNull();
  });

  it('포트폴리오는 있으나 스냅샷이 없으면 null(빈상태)', async () => {
    const service = new PortfolioService(
      makePrisma({ id: 'pf-1', riskSnapshots: [] }),
    );
    expect(await service.findLatestRiskSnapshot('user-1')).toBeNull();
  });

  it('옵셔널 필드 결측은 null 로 정규화한다', async () => {
    const service = new PortfolioService(
      makePrisma({
        id: 'pf-2',
        riskSnapshots: [
          {
            snapshotDate: '2026-06-11',
            totalValue: 5_000_000,
            cashAmount: null,
            unrealizedPnl: 0,
            unrealizedPnlPct: 0,
            topPositionPct: 100,
            topSectorPct: null,
            openPositionCount: 1,
            dailyPnl: null,
            dailyPnlPct: null,
            weeklyPnl: null,
            weeklyPnlPct: null,
            riskLevel: 'NORMAL',
            hardRuleBreached: false,
            hardRuleDetail: null,
          },
        ],
      }),
    );

    const result = await service.findLatestRiskSnapshot('user-2');

    expect(result?.cashAmount).toBeNull();
    expect(result?.topSectorPct).toBeNull();
    expect(result?.dailyPnl).toBeNull();
    expect(result?.weeklyPnlPct).toBeNull();
    expect(result?.hardRuleDetail).toBeNull();
    expect(result?.riskLevel).toBe('NORMAL');
    expect(result?.hardRuleBreached).toBe(false);
  });
});
