import { createHash } from 'crypto';

import {
  StrategyVersionDomainError,
  StrategyVersionLifecycle,
  StrategyVersionStatus,
  StrategyVersionTransition,
} from './strategy-version.types';

const ALLOWED_TRANSITIONS: Readonly<
  Record<StrategyVersionStatus, readonly StrategyVersionStatus[]>
> = {
  DRAFT: ['VALIDATED'],
  VALIDATED: ['DRAFT', 'BACKTESTED'],
  BACKTESTED: ['DRAFT', 'APPROVAL_PENDING'],
  APPROVAL_PENDING: ['APPROVED', 'REJECTED'],
  APPROVED: ['SCHEDULED'],
  SCHEDULED: ['APPROVED', 'ACTIVE'],
  ACTIVE: ['SUPERSEDED', 'ROLLED_BACK', 'RETIRED'],
  REJECTED: ['DRAFT'],
  SUPERSEDED: [],
  ROLLED_BACK: [],
  RETIRED: [],
};

export function assertStrategyVersionMutable(status: StrategyVersionStatus): void {
  if (status !== 'DRAFT') {
    throw new StrategyVersionDomainError(
      'STRATEGY_VERSION_NOT_MUTABLE',
      `Strategy version configuration is immutable in ${status}.`,
    );
  }
}

export function canTransitionStrategyVersion(
  from: StrategyVersionStatus,
  to: StrategyVersionStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function transitionStrategyVersion({
  current,
  target,
  now = new Date(),
  effectiveFrom,
}: StrategyVersionTransition): StrategyVersionLifecycle {
  if (!canTransitionStrategyVersion(current.status, target)) {
    throw new StrategyVersionDomainError(
      'INVALID_STRATEGY_VERSION_TRANSITION',
      `Strategy version cannot transition from ${current.status} to ${target}.`,
    );
  }

  const next: StrategyVersionLifecycle = {
    ...current,
    status: target,
  };

  if (target === 'DRAFT') {
    return {
      status: target,
      validatedAt: null,
      approvedAt: null,
      effectiveFrom: null,
      retiredAt: null,
    };
  }

  if (target === 'VALIDATED') {
    return { ...next, validatedAt: now };
  }

  if (target === 'APPROVED') {
    return {
      ...next,
      approvedAt: current.approvedAt ?? now,
      effectiveFrom: null,
    };
  }

  if (target === 'SCHEDULED') {
    if (!effectiveFrom) {
      throw new StrategyVersionDomainError(
        'EFFECTIVE_FROM_REQUIRED',
        'A scheduled strategy version requires effectiveFrom.',
      );
    }
    if (effectiveFrom.getTime() <= now.getTime()) {
      throw new StrategyVersionDomainError(
        'EFFECTIVE_FROM_NOT_FUTURE',
        'effectiveFrom must be later than the scheduling time.',
      );
    }
    return { ...next, effectiveFrom };
  }

  if (target === 'ACTIVE') {
    if (!current.effectiveFrom || now.getTime() < current.effectiveFrom.getTime()) {
      throw new StrategyVersionDomainError(
        'ACTIVATION_TOO_EARLY',
        'A scheduled strategy version cannot activate before effectiveFrom.',
      );
    }
  }

  if (target === 'SUPERSEDED' || target === 'ROLLED_BACK' || target === 'RETIRED') {
    return { ...next, retiredAt: now };
  }

  return next;
}

export function canonicalizeStrategyVersionConfig(value: unknown): string {
  return canonicalizeJsonValue(value, '$', new WeakSet<object>());
}

export function hashStrategyVersionConfig(value: unknown): string {
  return createHash('sha256').update(canonicalizeStrategyVersionConfig(value)).digest('hex');
}

function canonicalizeJsonValue(value: unknown, path: string, ancestors: WeakSet<object>): string {
  if (value === null) {
    return 'null';
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw invalidConfig(path, 'numbers must be finite');
    }
    return JSON.stringify(value);
  }

  if (typeof value !== 'object') {
    throw invalidConfig(path, `unsupported value type: ${typeof value}`);
  }

  if (ancestors.has(value)) {
    throw invalidConfig(path, 'cyclic references are not supported');
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const items: string[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          throw invalidConfig(`${path}[${index}]`, 'sparse arrays are invalid');
        }
        items.push(canonicalizeJsonValue(value[index], `${path}[${index}]`, ancestors));
      }
      return `[${items.join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw invalidConfig(path, 'only plain JSON objects are supported');
    }

    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw invalidConfig(path, 'symbol keys are not supported');
    }

    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalizeJsonValue(
            record[key],
            `${path}.${key}`,
            ancestors,
          )}`,
      );
    return `{${entries.join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

function invalidConfig(path: string, reason: string): StrategyVersionDomainError {
  return new StrategyVersionDomainError(
    'INVALID_STRATEGY_CONFIG',
    `Invalid strategy config at ${path}: ${reason}.`,
  );
}
