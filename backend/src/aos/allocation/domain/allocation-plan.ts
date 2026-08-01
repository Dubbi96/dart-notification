import { createHash } from 'crypto';

import { canonicalizeJson } from '@dart-notification/aos-rule-engine';

export const AOS_ALLOCATION_WEIGHTS = Object.freeze({
  SPGI: 50,
  VTI: 30,
  SYSTEM_TRADING: 20,
});

export class AosAllocationDomainError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'AosAllocationDomainError';
  }
}

export interface AllocationAmounts {
  grossRealizedProfitKrw: number;
  taxReserveKrw: number;
  fxReserveKrw: number;
  distributableProfitKrw: number;
  items: Array<{
    destination: keyof typeof AOS_ALLOCATION_WEIGHTS;
    weight: number;
    amountKrw: number;
  }>;
}

/**
 * 원 단위 정수만 받는다. 외부 장기자산(SPGI/VTI)은 각 비율의 내림값을 받고,
 * 나머지는 SYSTEM_TRADING에 귀속해 분배 합계가 항상 원금과 정확히 일치한다.
 */
export function calculateAllocationAmounts(input: {
  grossRealizedProfitKrw: number;
  taxReserveKrw: number;
  fxReserveKrw: number;
}): AllocationAmounts {
  const values = [input.grossRealizedProfitKrw, input.taxReserveKrw, input.fxReserveKrw];
  if (!values.every(Number.isSafeInteger)) {
    throw new AosAllocationDomainError('AOS_ALLOCATION_WHOLE_KRW_REQUIRED');
  }
  if (input.grossRealizedProfitKrw <= 0) {
    throw new AosAllocationDomainError('AOS_ALLOCATION_POSITIVE_REALIZED_PROFIT_REQUIRED');
  }
  if (input.taxReserveKrw < 0 || input.fxReserveKrw < 0) {
    throw new AosAllocationDomainError('AOS_ALLOCATION_RESERVE_NEGATIVE');
  }
  const distributableProfitKrw =
    input.grossRealizedProfitKrw - input.taxReserveKrw - input.fxReserveKrw;
  if (distributableProfitKrw <= 0) {
    throw new AosAllocationDomainError('AOS_ALLOCATION_NO_DISTRIBUTABLE_PROFIT');
  }
  const distributable = BigInt(distributableProfitKrw);
  const spgi = Number((distributable * 50n) / 100n);
  const vti = Number((distributable * 30n) / 100n);
  const systemTrading = distributableProfitKrw - spgi - vti;
  return {
    ...input,
    distributableProfitKrw,
    items: [
      { destination: 'SPGI', weight: 0.5, amountKrw: spgi },
      { destination: 'VTI', weight: 0.3, amountKrw: vti },
      { destination: 'SYSTEM_TRADING', weight: 0.2, amountKrw: systemTrading },
    ],
  };
}

export function allocationHash(value: unknown): string {
  return createHash('sha256')
    .update(canonicalizeJson(value as never))
    .digest('hex');
}
