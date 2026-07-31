import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../../../prisma/prisma.service';
import { AosStepUpService } from './aos-step-up.service';

jest.mock('bcrypt', () => ({ compare: jest.fn() }));

describe('AosStepUpService', () => {
  it('password 재인증 뒤 단일 사용 grant를 발급한다', async () => {
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ password: 'hash', provider: 'local' }) },
      aosStepUpGrant: { create: jest.fn().mockResolvedValue({ id: 'grant-1' }) },
    } as unknown as PrismaService;
    const jwt = { signAsync: jest.fn().mockResolvedValue('signed') } as unknown as JwtService;
    const service = new AosStepUpService(prisma, jwt, config());
    await expect(service.issue('u1', 'password1', 'APPROVAL')).resolves.toEqual(
      expect.objectContaining({ token: 'signed', scope: 'APPROVAL', singleUse: true }),
    );
  });

  it('같은 grant 재사용은 updateMany count=0이면 차단한다', async () => {
    const prisma = {
      aosStepUpGrant: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    } as unknown as PrismaService;
    const jwt = {
      verifyAsync: jest.fn().mockResolvedValue({
        sub: 'u1',
        type: 'aos_step_up',
        jti: 'jti',
        scope: 'APPROVAL',
        grantId: 'g1',
      }),
    } as unknown as JwtService;
    const service = new AosStepUpService(prisma, jwt, config());
    await expect(service.consume('token', 'u1', 'APPROVAL')).rejects.toThrow(
      'AOS_STEP_UP_ALREADY_USED_OR_EXPIRED',
    );
  });
});

function config() {
  return { getOrThrow: jest.fn().mockReturnValue('0123456789abcdef') } as unknown as ConfigService;
}
