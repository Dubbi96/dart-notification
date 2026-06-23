/**
 * paper-simulation.controller.spec.ts — 리셋 엔드포인트 휴먼 승인 게이트 (DAR-429)
 *
 * POST /reset 는 운영영향 → JWT(인증)에 더해 body.confirm='RESET' 확인 토큰이 있어야만 실행한다.
 *   - 토큰 불일치/누락 → 서비스 미호출·변경 없음(success:false).
 *   - 토큰 일치 → resetSimulation 1회 호출·결과 래핑.
 */

import { PaperSimulationController } from './paper-simulation.controller';

function makeController() {
  const sim = {
    resetSimulation: jest.fn().mockResolvedValue({
      portfolioId: 'pf1',
      deletedPositions: 46,
      deletedDailySnapshots: 120,
      deletedExitSignals: 12,
      deletedPaperTrades: 46,
      deletedRiskSnapshots: 30,
      deletedFunnelDaily: 30,
      cashAfter: 10_000_000,
      openPositionsAfter: 0,
    }),
  };
  const controller = new PaperSimulationController(sim as never);
  return { controller, sim };
}

describe('DAR-429 PaperSimulationController.reset — 확인 토큰 게이트', () => {
  it('confirm 누락 시 서비스 미호출·success:false', async () => {
    const { controller, sim } = makeController();
    const res = await controller.reset({});
    expect(res.success).toBe(false);
    expect(sim.resetSimulation).not.toHaveBeenCalled();
  });

  it('confirm 오타 시 서비스 미호출·success:false', async () => {
    const { controller, sim } = makeController();
    const res = await controller.reset({ confirm: 'reset' });
    expect(res.success).toBe(false);
    expect(sim.resetSimulation).not.toHaveBeenCalled();
  });

  it("confirm='RESET' 시 resetSimulation 1회 호출·현금 10M 결과 래핑", async () => {
    const { controller, sim } = makeController();
    const res = await controller.reset({ confirm: 'RESET' });
    expect(res.success).toBe(true);
    expect(sim.resetSimulation).toHaveBeenCalledTimes(1);
    expect((res as { data: { cashAfter: number; openPositionsAfter: number } }).data.cashAfter).toBe(
      10_000_000,
    );
    expect(
      (res as { data: { openPositionsAfter: number } }).data.openPositionsAfter,
    ).toBe(0);
  });
});
