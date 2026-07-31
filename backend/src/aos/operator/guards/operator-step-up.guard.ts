import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AosStepUpScope } from '@prisma/client';

import { AosStepUpService } from '../services/aos-step-up.service';
import { OperatorPrincipal } from './operator-access.guard';

const STEP_UP_SCOPE_KEY = 'aos.operator.step-up-scope';

export const RequireStepUp = (scope: AosStepUpScope) => SetMetadata(STEP_UP_SCOPE_KEY, scope);

export interface ConsumedStepUp {
  readonly grantId: string;
  readonly scope: AosStepUpScope;
  readonly method: string;
}

@Injectable()
export class OperatorStepUpGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    private readonly stepUp: AosStepUpService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const enabled = this.config.get<string | boolean>('AOS_OPERATOR_MUTATIONS_ENABLED', false);
    if (enabled !== true && enabled !== 'true') {
      throw new ForbiddenException('AOS_OPERATOR_READ_ONLY');
    }
    const scope = this.reflector.getAllAndOverride<AosStepUpScope>(STEP_UP_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!scope) throw new ForbiddenException('AOS_STEP_UP_SCOPE_REQUIRED');
    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      operator?: OperatorPrincipal;
      consumedStepUp?: ConsumedStepUp;
    }>();
    if (!request.operator) throw new ForbiddenException('AOS_OPERATOR_AUTH_REQUIRED');
    const raw = request.headers['x-aos-step-up-token'];
    const token = Array.isArray(raw) ? raw[0] : raw;
    if (!token) throw new ForbiddenException('AOS_STEP_UP_REQUIRED');
    request.consumedStepUp = await this.stepUp.consume(token, request.operator.userId, scope);
    return true;
  }
}
