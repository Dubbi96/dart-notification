import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

import { PrismaService } from '../../../prisma/prisma.service';
import { OperatorAccessGuard } from './operator-access.guard';

describe('OperatorAccessGuard', () => {
  it('VIEWER가 구성 변경 권한을 요구하는 경로에 접근하면 차단한다', async () => {
    const request = { user: { id: 'viewer-1', email: 'viewer@example.com' } };
    const guard = new OperatorAccessGuard(
      reflector(['CONFIG_WRITE']),
      prisma({ role: 'VIEWER', status: 'ACTIVE' }),
      config(''),
    );

    await expect(guard.canActivate(context(request))).rejects.toBeInstanceOf(ForbiddenException);
    expect(request).not.toHaveProperty('operator');
  });

  it('bootstrap 이메일은 환경변수에 정확히 등록된 경우에만 ADMIN으로 읽는다', async () => {
    const request: Record<string, unknown> = {
      user: { id: 'bootstrap-1', email: 'ADMIN@example.com' },
    };
    const guard = new OperatorAccessGuard(
      reflector(['CONFIG_APPROVE']),
      prisma(null),
      config('admin@example.com'),
    );

    await expect(guard.canActivate(context(request))).resolves.toBe(true);
    expect(request.operator).toEqual(
      expect.objectContaining({ role: 'ADMIN', source: 'BOOTSTRAP_ENV' }),
    );
  });
});

function reflector(required: string[]) {
  return {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector;
}

function prisma(membership: { role: string; status: string } | null) {
  return {
    aosOperatorMembership: { findUnique: jest.fn().mockResolvedValue(membership) },
  } as unknown as PrismaService;
}

function config(emails: string) {
  return { get: jest.fn().mockReturnValue(emails) } as unknown as ConfigService;
}

function context(request: Record<string, unknown>) {
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}
