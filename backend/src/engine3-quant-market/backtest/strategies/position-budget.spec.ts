import { resolvePositionBudget } from '../backtest-runner.service';

/**
 * DAR-404 — 사이징 룰별 포지션 예산 산정(point-in-time 안전: 자기 점수만 사용).
 */
describe('resolvePositionBudget (DAR-404)', () => {
  const capital = 10_000_000;
  const maxPositions = 20;
  const base = capital / maxPositions; // 500,000

  it('EQUAL_WEIGHT 은 점수와 무관하게 균등 예산', () => {
    expect(resolvePositionBudget(capital, maxPositions, 'EQUAL_WEIGHT', 50)).toBe(base);
    expect(resolvePositionBudget(capital, maxPositions, 'EQUAL_WEIGHT', 95)).toBe(base);
  });

  it('SCORE_WEIGHT 은 buyScore 를 [0.5, 1.5] 배수로 환산', () => {
    expect(resolvePositionBudget(capital, maxPositions, 'SCORE_WEIGHT', 50)).toBeCloseTo(base * 1.0);
    expect(resolvePositionBudget(capital, maxPositions, 'SCORE_WEIGHT', 100)).toBeCloseTo(base * 1.5);
    expect(resolvePositionBudget(capital, maxPositions, 'SCORE_WEIGHT', 0)).toBeCloseTo(base * 0.5);
    expect(resolvePositionBudget(capital, maxPositions, 'SCORE_WEIGHT', 80)).toBeCloseTo(base * 1.3);
  });

  it('SCORE_WEIGHT 은 점수가 높을수록 더 큰 예산(단조 증가)', () => {
    const low = resolvePositionBudget(capital, maxPositions, 'SCORE_WEIGHT', 60);
    const high = resolvePositionBudget(capital, maxPositions, 'SCORE_WEIGHT', 90);
    expect(high).toBeGreaterThan(low);
  });

  it('범위 밖/비유한 점수는 [0,100] 으로 클램프', () => {
    expect(resolvePositionBudget(capital, maxPositions, 'SCORE_WEIGHT', 150)).toBeCloseTo(base * 1.5);
    expect(resolvePositionBudget(capital, maxPositions, 'SCORE_WEIGHT', -10)).toBeCloseTo(base * 0.5);
    expect(resolvePositionBudget(capital, maxPositions, 'SCORE_WEIGHT', NaN)).toBeCloseTo(base * 0.5);
  });
});
