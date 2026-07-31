import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';

import { PrismaService } from '../../../prisma/prisma.service';
import {
  OperatorPermission,
  OperatorRole,
  permissionsForRole,
  roleHasPermissions,
} from '../domain/operator-permissions';

const OPERATOR_PERMISSION_KEY = 'aos.operator.permissions';

export const RequireOperatorPermissions = (...permissions: OperatorPermission[]) =>
  SetMetadata(OPERATOR_PERMISSION_KEY, permissions);

export interface OperatorPrincipal {
  readonly userId: string;
  readonly email: string;
  readonly role: OperatorRole;
  readonly permissions: readonly OperatorPermission[];
  readonly source: 'MEMBERSHIP' | 'BOOTSTRAP_ENV';
}

@Injectable()
export class OperatorAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user?: { id: string; email: string };
      operator?: OperatorPrincipal;
    }>();
    if (!request.user) throw new ForbiddenException('AOS_OPERATOR_AUTH_REQUIRED');
    const required = this.reflector.getAllAndOverride<OperatorPermission[]>(
      OPERATOR_PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    ) ?? ['OPERATOR_READ'];
    const membership = await this.prisma.aosOperatorMembership.findUnique({
      where: { userId: request.user.id },
      select: { role: true, status: true },
    });
    let role: OperatorRole | null =
      membership?.status === 'ACTIVE' ? (membership.role as OperatorRole) : null;
    let source: OperatorPrincipal['source'] = 'MEMBERSHIP';
    if (!role && bootstrapEmails(this.config).has(request.user.email.toLowerCase())) {
      role = 'ADMIN';
      source = 'BOOTSTRAP_ENV';
    }
    if (!role || !roleHasPermissions(role, required)) {
      throw new ForbiddenException('AOS_OPERATOR_PERMISSION_DENIED');
    }
    request.operator = {
      userId: request.user.id,
      email: request.user.email,
      role,
      permissions: permissionsForRole(role),
      source,
    };
    return true;
  }
}

function bootstrapEmails(config: ConfigService): Set<string> {
  return new Set(
    (config.get<string>('AOS_OPERATOR_BOOTSTRAP_EMAILS', '') ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  );
}
