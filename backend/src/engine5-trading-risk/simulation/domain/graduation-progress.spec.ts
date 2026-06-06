// 30일 모의운용 진행률 계산기 단위 스펙 (DAR-86)
// 핵심 가드: 운용 시작 전/데이터 부족이면 awaitingMeasurement=true 로 정직 표기(과신 방지),
//   경과/잔여일은 null. 순수 함수라 startDate/asOf 고정 → 결정론적.

import {
  calcSimulationProgress,
  SIMULATION_WINDOW_DAYS,
} from './graduation-metrics.calculator';

describe('calcSimulationProgress (DAR-86)', () => {
  it('시작일이 없으면(운용 시작 전) awaitingMeasurement=true · 경과/잔여 null', () => {
    const r = calcSimulationProgress(null, '2026-06-06T00:00:00.000Z');
    expect(r.awaitingMeasurement).toBe(true);
    expect(r.elapsedDays).toBeNull();
    expect(r.remainingDays).toBeNull();
    expect(r.progressRatio).toBe(0);
    expect(r.windowComplete).toBe(false);
    expect(r.windowDays).toBe(SIMULATION_WINDOW_DAYS);
  });

  it('운용 중반(15일 경과)이면 경과 15·잔여 15·진행률 0.5', () => {
    // 5/22 시작 → 6/6 기준 정확히 15일 경과
    const r = calcSimulationProgress(
      '2026-05-22T00:00:00.000Z',
      '2026-06-06T00:00:00.000Z',
    );
    expect(r.awaitingMeasurement).toBe(false);
    expect(r.elapsedDays).toBe(15);
    expect(r.remainingDays).toBe(15);
    expect(r.progressRatio).toBeCloseTo(0.5, 5);
    expect(r.windowComplete).toBe(false);
    expect(r.startDate).toBe('2026-05-22T00:00:00.000Z');
  });

  it('시작 당일(0일 경과)이면 경과 0·잔여 30·진행률 0', () => {
    const r = calcSimulationProgress(
      '2026-06-06T00:00:00.000Z',
      '2026-06-06T00:00:00.000Z',
    );
    expect(r.elapsedDays).toBe(0);
    expect(r.remainingDays).toBe(30);
    expect(r.progressRatio).toBe(0);
    expect(r.awaitingMeasurement).toBe(false);
  });

  it('30일 도달이면 잔여 0·진행률 1·windowComplete=true', () => {
    const r = calcSimulationProgress(
      '2026-05-07T00:00:00.000Z', // 6/6 기준 30일
      '2026-06-06T00:00:00.000Z',
    );
    expect(r.elapsedDays).toBe(30);
    expect(r.remainingDays).toBe(0);
    expect(r.progressRatio).toBe(1);
    expect(r.windowComplete).toBe(true);
  });

  it('30일 초과(완주 이후)면 잔여 0·진행률 1로 상한(clamp)', () => {
    const r = calcSimulationProgress(
      '2026-04-01T00:00:00.000Z', // 6/6 기준 66일
      '2026-06-06T00:00:00.000Z',
    );
    expect(r.elapsedDays).toBe(66);
    expect(r.remainingDays).toBe(0);
    expect(r.progressRatio).toBe(1);
    expect(r.windowComplete).toBe(true);
  });

  it('시작일이 미래면(운용 시작 전) awaitingMeasurement=true', () => {
    const r = calcSimulationProgress(
      '2026-07-01T00:00:00.000Z',
      '2026-06-06T00:00:00.000Z',
    );
    expect(r.awaitingMeasurement).toBe(true);
    expect(r.elapsedDays).toBeNull();
    expect(r.remainingDays).toBeNull();
  });

  it('windowDays 를 명시 지정하면 그 창으로 잔여를 환산한다', () => {
    const r = calcSimulationProgress(
      '2026-06-01T00:00:00.000Z',
      '2026-06-06T00:00:00.000Z',
      10,
    );
    expect(r.windowDays).toBe(10);
    expect(r.elapsedDays).toBe(5);
    expect(r.remainingDays).toBe(5);
    expect(r.progressRatio).toBeCloseTo(0.5, 5);
  });
});
