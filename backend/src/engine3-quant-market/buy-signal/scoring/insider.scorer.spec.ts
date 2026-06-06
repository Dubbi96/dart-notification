/**
 * insider.scorer.spec.ts — DAR-88
 *
 * 내부자/대량보유 동향 점수: 순매수 가점·대량매도 감점·결측 0 안전처리 검증.
 * AI 금지영역: 순수 Rule 검증.
 */

import { scoreInsider, InsiderTradeInput } from './insider.scorer';

function trade(p: Partial<InsiderTradeInput>): InsiderTradeInput {
  return {
    source: 'EXECUTIVE',
    tradeType: 'BUY',
    ratioChange: null,
    isMajorShareholder: null,
    ...p,
  };
}

describe('scoreInsider()', () => {
  it('보고 0건(결측) → 0 안전처리', () => {
    expect(scoreInsider({ trades: [] })).toBe(0);
  });

  it('null/undefined 입력 방어 → 0', () => {
    // @ts-expect-error 방어 경로 검증
    expect(scoreInsider(undefined)).toBe(0);
    // @ts-expect-error 방어 경로 검증
    expect(scoreInsider({})).toBe(0);
  });

  it('임원 순매수 → 양수 가점', () => {
    const s = scoreInsider({ trades: [trade({ tradeType: 'BUY', source: 'EXECUTIVE' })] });
    expect(s).toBeGreaterThan(0);
  });

  it('임원 매수가 5% 대량보유 매수보다 가점이 크다', () => {
    const exec = scoreInsider({ trades: [trade({ tradeType: 'BUY', source: 'EXECUTIVE' })] });
    const major = scoreInsider({ trades: [trade({ tradeType: 'BUY', source: 'MAJOR_STOCK' })] });
    expect(exec).toBeGreaterThan(major);
  });

  it('유의미한 지분율 변동(|Δ%p|≥1) 매수는 추가 가점', () => {
    const small = scoreInsider({ trades: [trade({ tradeType: 'BUY', ratioChange: 0.2 })] });
    const big = scoreInsider({ trades: [trade({ tradeType: 'BUY', ratioChange: 2.0 })] });
    expect(big).toBeGreaterThan(small);
  });

  it('대량매도(SELL) → 감점(음수)', () => {
    const s = scoreInsider({ trades: [trade({ tradeType: 'SELL', source: 'EXECUTIVE' })] });
    expect(s).toBeLessThan(0);
  });

  it('주요주주 대량매도는 추가 감점', () => {
    const plain = scoreInsider({
      trades: [trade({ tradeType: 'SELL', ratioChange: -2, isMajorShareholder: false })],
    });
    const major = scoreInsider({
      trades: [trade({ tradeType: 'SELL', ratioChange: -2, isMajorShareholder: true })],
    });
    expect(major).toBeLessThan(plain);
  });

  it('MIXED/UNKNOWN(방향 불명) → 무가점', () => {
    const s = scoreInsider({
      trades: [trade({ tradeType: 'MIXED' }), trade({ tradeType: 'UNKNOWN' })],
    });
    expect(s).toBe(0);
  });

  it('순매수 + 순매도 혼재 시 상계되어 합산', () => {
    const s = scoreInsider({
      trades: [
        trade({ tradeType: 'BUY', source: 'EXECUTIVE' }),
        trade({ tradeType: 'SELL', source: 'EXECUTIVE' }),
      ],
    });
    // BUY(+25) + SELL(-30) = -5
    expect(s).toBe(-5);
  });

  it('점수는 -100..100 으로 clamp', () => {
    const manyBuys = Array.from({ length: 20 }, () =>
      trade({ tradeType: 'BUY', source: 'EXECUTIVE', ratioChange: 5 }),
    );
    const manySells = Array.from({ length: 20 }, () =>
      trade({ tradeType: 'SELL', source: 'EXECUTIVE', ratioChange: -5, isMajorShareholder: true }),
    );
    expect(scoreInsider({ trades: manyBuys })).toBe(100);
    expect(scoreInsider({ trades: manySells })).toBe(-100);
  });
});
