import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

import { AosStepUpService } from '../services/aos-step-up.service';
import { OperatorStepUpGuard } from './operator-step-up.guard';

describe('OperatorStepUpGuard', () => {
  it('mutation feature flag 기본 OFF에서는 토큰을 소비하지 않고 차단한다', async () => {
    const stepUp = { consume: jest.fn() } as unknown as AosStepUpService;
    const guard = new OperatorStepUpGuard(
      reflector('CONFIG_CHANGE'),
      config(false),
      stepUp,
    );

    await expect(guard.canActivate(context('token'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(stepUp.consume).not.toHaveBeenCalled();
  });

  it('활성화 상태에서는 범위가 맞는 단일 사용 토큰만 소비한다', async () => {
    const consumed = { grantId: 'grant-1', scope: 'APPROVAL', method: 'LOCAL_PASSWORD' };
    const stepUp = {
      consume: jest.fn().mockResolvedValue(consumed),
    } as unknown as AosStepUpService;
    const request = operatorRequest('token');
    const guard = new OperatorStepUpGuard(reflector('APPROVAL'), config(true), stepUp);

    await expect(guard.canActivate(rawContext(request))).resolves.toBe(true);
    expect(stepUp.consume).toHaveBeenCalledWith('token', 'approver-1', 'APPROVAL');
    expect(request.consumedStepUp).toEqual(consumed);
  });
});

function reflector(scope: string) {
  return {
    getAllAndOverride: jest.fn().mockReturnValue(scope),
  } as unknown as Reflector;
}

function config(enabled: boolean) {
  return { get: jest.fn().mockReturnValue(enabled) } as unknown as ConfigService;
}

function operatorRequest(token: string) {
  return {
    headers: { 'x-aos-step-up-token': token },
    operator: {
      userId: 'approver-1',
      email: 'approver@example.com',
      role: 'APPROVER',
      permissions: ['OPERATOR_READ', 'CONFIG_APPROVE'],
      source: 'MEMBERSHIP',
    },
    consumedStepUp: undefined as unknown,
  };
}

function rawContext(request: ReturnType<typeof operatorRequest>) {
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}

function context(token: string) {
  return rawContext(operatorRequest(token));
}
