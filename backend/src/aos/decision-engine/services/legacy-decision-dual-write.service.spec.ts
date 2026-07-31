import { ConfigService } from '@nestjs/config';

import { BuySignalService } from '../../../engine3-quant-market/buy-signal/buy-signal.service';
import { LegacyDecisionDualWriteService } from './legacy-decision-dual-write.service';

describe('LegacyDecisionDualWriteService', () => {
  it('기본 OFF에서는 DB·evaluator를 전혀 호출하지 않는다', async () => {
    const config = { get: jest.fn().mockReturnValue(false) } as unknown as ConfigService;
    const prisma = { strategyVersion: { findFirst: jest.fn() } } as any;
    const regime = { freeze: jest.fn() } as any;
    const evaluator = { execute: jest.fn() } as any;
    const service = new LegacyDecisionDualWriteService(
      config,
      prisma,
      new BuySignalService(),
      regime,
      evaluator,
    );

    await expect(service.tryRecord({} as any)).resolves.toEqual({ status: 'DISABLED' });
    expect(prisma.strategyVersion.findFirst).not.toHaveBeenCalled();
    expect(regime.freeze).not.toHaveBeenCalled();
    expect(evaluator.execute).not.toHaveBeenCalled();
  });

  it('baseline 조회 실패를 legacy 경로와 격리한다', async () => {
    const config = { get: jest.fn().mockReturnValue('true') } as unknown as ConfigService;
    const prisma = {
      strategyVersion: { findFirst: jest.fn().mockResolvedValue(null) },
      riskPolicyVersion: { findFirst: jest.fn().mockResolvedValue(null) },
    } as any;
    const service = new LegacyDecisionDualWriteService(
      config,
      prisma,
      new BuySignalService(),
      { freeze: jest.fn() } as any,
      { execute: jest.fn() } as any,
    );

    await expect(service.tryRecord({} as any)).resolves.toEqual({ status: 'FAILED' });
  });
});
