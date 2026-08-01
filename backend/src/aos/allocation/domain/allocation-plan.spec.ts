import {
  allocationHash,
  AosAllocationDomainError,
  calculateAllocationAmounts,
} from './allocation-plan';

describe('AOS realized-profit allocation', () => {
  it('50/30/20을 원 단위로 배분하고 잔여 원은 시스템 자금에 둔다', () => {
    const result = calculateAllocationAmounts({
      grossRealizedProfitKrw: 101,
      taxReserveKrw: 0,
      fxReserveKrw: 0,
    });
    expect(result.items).toEqual([
      { destination: 'SPGI', weight: 0.5, amountKrw: 50 },
      { destination: 'VTI', weight: 0.3, amountKrw: 30 },
      { destination: 'SYSTEM_TRADING', weight: 0.2, amountKrw: 21 },
    ]);
    expect(result.items.reduce((sum, item) => sum + item.amountKrw, 0)).toBe(101);
  });

  it.each([
    [
      { grossRealizedProfitKrw: 0, taxReserveKrw: 0, fxReserveKrw: 0 },
      'AOS_ALLOCATION_POSITIVE_REALIZED_PROFIT_REQUIRED',
    ],
    [
      { grossRealizedProfitKrw: -1, taxReserveKrw: 0, fxReserveKrw: 0 },
      'AOS_ALLOCATION_POSITIVE_REALIZED_PROFIT_REQUIRED',
    ],
    [
      { grossRealizedProfitKrw: 100, taxReserveKrw: 100, fxReserveKrw: 0 },
      'AOS_ALLOCATION_NO_DISTRIBUTABLE_PROFIT',
    ],
    [
      { grossRealizedProfitKrw: 100, taxReserveKrw: -1, fxReserveKrw: 0 },
      'AOS_ALLOCATION_RESERVE_NEGATIVE',
    ],
    [
      { grossRealizedProfitKrw: 100.5, taxReserveKrw: 0, fxReserveKrw: 0 },
      'AOS_ALLOCATION_WHOLE_KRW_REQUIRED',
    ],
  ])('손실·0원·유보액 오류는 계획을 만들지 않는다', (input, code) => {
    expect(() => calculateAllocationAmounts(input)).toThrow(
      expect.objectContaining<AosAllocationDomainError>({ code }),
    );
  });

  it('세금과 FX 유보액을 먼저 제외한 뒤 배분 합계를 정확히 보존한다', () => {
    const result = calculateAllocationAmounts({
      grossRealizedProfitKrw: 10_000_003,
      taxReserveKrw: 1_000_000,
      fxReserveKrw: 3,
    });
    expect(result.distributableProfitKrw).toBe(9_000_000);
    expect(result.items.map((item) => item.amountKrw)).toEqual([
      4_500_000, 2_700_000, 1_800_000,
    ]);
    expect(result.items.reduce((sum, item) => sum + item.amountKrw, 0)).toBe(
      result.distributableProfitKrw,
    );
  });

  it('같은 evidence는 순서와 무관하게 같은 hash를 만든다', () => {
    expect(allocationHash({ b: 2, a: 1 })).toBe(allocationHash({ a: 1, b: 2 }));
  });
});
