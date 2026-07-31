import { createHash, randomUUID } from 'crypto';

import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AosStepUpScope } from '@prisma/client';
import * as bcrypt from 'bcrypt';

import { PrismaService } from '../../../prisma/prisma.service';
import { ConsumedStepUp } from '../guards/operator-step-up.guard';

const STEP_UP_TTL_SECONDS = 5 * 60;

@Injectable()
export class AosStepUpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async issue(userId: string, password: string, scope: AosStepUpScope) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { password: true, provider: true },
    });
    if (!user?.password || user.provider !== 'local') {
      throw new ForbiddenException('AOS_STEP_UP_PASSWORD_UNAVAILABLE');
    }
    if (!(await bcrypt.compare(password, user.password))) {
      throw new UnauthorizedException('AOS_STEP_UP_INVALID_CREDENTIALS');
    }
    const jti = randomUUID();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + STEP_UP_TTL_SECONDS * 1000);
    const grant = await this.prisma.aosStepUpGrant.create({
      data: {
        userId,
        tokenIdHash: sha256(jti),
        scope,
        expiresAt,
      },
      select: { id: true },
    });
    const token = await this.jwt.signAsync(
      { sub: userId, type: 'aos_step_up', jti, scope, grantId: grant.id },
      {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
        expiresIn: STEP_UP_TTL_SECONDS,
      },
    );
    return { token, scope, expiresAt, singleUse: true as const };
  }

  async consume(
    token: string,
    expectedUserId: string,
    expectedScope: AosStepUpScope,
  ): Promise<ConsumedStepUp> {
    let payload: {
      sub?: string;
      type?: string;
      jti?: string;
      scope?: AosStepUpScope;
      grantId?: string;
    };
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow<string>('JWT_SECRET'),
      });
    } catch {
      throw new ForbiddenException('AOS_STEP_UP_INVALID_OR_EXPIRED');
    }
    if (
      payload.type !== 'aos_step_up' ||
      payload.sub !== expectedUserId ||
      payload.scope !== expectedScope ||
      !payload.jti ||
      !payload.grantId
    ) {
      throw new ForbiddenException('AOS_STEP_UP_SCOPE_OR_SUBJECT_MISMATCH');
    }
    const consumedAt = new Date();
    const consumed = await this.prisma.aosStepUpGrant.updateMany({
      where: {
        id: payload.grantId,
        userId: expectedUserId,
        tokenIdHash: sha256(payload.jti),
        scope: expectedScope,
        consumedAt: null,
        expiresAt: { gt: consumedAt },
      },
      data: { consumedAt },
    });
    if (consumed.count !== 1) {
      throw new ForbiddenException('AOS_STEP_UP_ALREADY_USED_OR_EXPIRED');
    }
    return { grantId: payload.grantId, scope: expectedScope, method: 'PASSWORD' };
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
