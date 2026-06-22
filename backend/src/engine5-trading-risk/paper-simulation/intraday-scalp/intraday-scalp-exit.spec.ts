// DAR-411 / DAR-418 — 분봉 단타 청산 판정(순수 Rule) 결정론 검증.
// 순(net) 익절 +2% / 순 손절 -1.2% / 15:20 전량 강제청산(당일 청산 보장).
// ★DAR-418 fee-aware: 익절/손절은 gross 가 아니라 net(=gross−왕복비용율) 기준으로 판정한다.

import {
  evaluateScalpExit,
  isForceExitTime,
  isPastEntryCutoff,
  passesEntryFeeHurdle,
  grossTakeProfitThresholdPct,
  grossStopLossThresholdPct,
  TAKE_PROFIT_PCT,
  STOP_LOSS_PCT,
  FORCE_EXIT_HHMM,
  DEFAULT_ROUND_TRIP_COST_PCT,
  DEFAULT_SCALP_EXIT_PARAMS,
  ENTRY_FEE_HURDLE_MIN_MARGIN_PCT,
} from './intraday-scalp-exit';
import { DEFAULT_FILL_PARAMS, roundTripCostPct } from '../../domain/fill-simulator';

describe('왕복 거래비용율(SSOT)', () => {
  it('DEFAULT_ROUND_TRIP_COST_PCT = 체결 파라미터에서 산출(2·수수료+매도세+2·슬리피지)', () => {
    // 2·0.015% + 0.18% + 2·0.05% = 0.31%
    expect(DEFAULT_ROUND_TRIP_COST_PCT).toBeCloseTo(0.31, 6);
    expect(DEFAULT_ROUND_TRIP_COST_PCT).toBe(roundTripCostPct(DEFAULT_FILL_PARAMS));
    expect(DEFAULT_SCALP_EXIT_PARAMS.roundTripCostPct).toBe(DEFAULT_ROUND_TRIP_COST_PCT);
  });

  it('gross 임계 환산: 익절은 비용만큼 상향, 손절은 비용만큼 좁힘(상향)', () => {
    expect(grossTakeProfitThresholdPct()).toBeCloseTo(2.31, 6); // 순 +2% 달성하려면 gross +2.31%
    expect(grossStopLossThresholdPct()).toBeCloseTo(-0.89, 6); // 순 -1.2% 손절은 gross -0.89%에서(과손실 방지)
  });
});

describe('evaluateScalpExit (net 기준)', () => {
  it('익절: net +2% 도달 시 TAKE_PROFIT (gross +2.31% 필요)', () => {
    const d = evaluateScalpExit(1000, 1023.1, '1000'); // gross +2.31% → net +2.0%
    expect(d.shouldExit).toBe(true);
    expect(d.reason).toBe('TAKE_PROFIT');
    expect(d.grossReturnPct).toBeCloseTo(2.31, 6);
    expect(d.netReturnPct).toBeCloseTo(2.0, 6);
  });

  it('★fee-aware 핵심: gross +2% 익절은 비용에 먹혀 net +1.69% → 익절 아님(보유 유지)', () => {
    const d = evaluateScalpExit(1000, 1020, '1000'); // gross +2.0% → net +1.69%
    expect(d.shouldExit).toBe(false);
    expect(d.reason).toBeNull();
    expect(d.netReturnPct).toBeCloseTo(1.69, 6);
  });

  it('손절: net -1.2% 도달 시 STOP_LOSS (gross -0.89% 임계 통과)', () => {
    const d = evaluateScalpExit(1000, 991, '1000'); // gross -0.9% → net -1.21% (임계 -0.89% 통과)
    expect(d.shouldExit).toBe(true);
    expect(d.reason).toBe('STOP_LOSS');
    expect(d.grossReturnPct).toBeCloseTo(-0.9, 6);
    expect(d.netReturnPct).toBeCloseTo(-1.21, 6);
  });

  it('손절 임계 직전: gross -0.88%(net -1.19%) → 보유 유지(과손실 방지)', () => {
    const d = evaluateScalpExit(1000, 991.2, '1000'); // gross -0.88% → net -1.19% (아직 미달)
    expect(d.shouldExit).toBe(false);
    expect(d.reason).toBeNull();
  });

  it('손절 미도달: gross -0.5%(net -0.81%) → 보유 유지', () => {
    const d = evaluateScalpExit(1000, 995, '1000'); // gross -0.5% → net -0.81%
    expect(d.shouldExit).toBe(false);
    expect(d.reason).toBeNull();
  });

  it('15:20 강제청산은 손익 무관 최우선 — net 미달이어도 청산', () => {
    const d = evaluateScalpExit(1000, 1005, '1520'); // net 미달
    expect(d.shouldExit).toBe(true);
    expect(d.reason).toBe('FORCE_CLOSE_EOD');
  });

  it('15:20 강제청산은 손실 포지션도 무조건 청산(오버나잇 금지)', () => {
    const d = evaluateScalpExit(1000, 995, '1521');
    expect(d.shouldExit).toBe(true);
    expect(d.reason).toBe('FORCE_CLOSE_EOD');
  });

  it('15:19 까지는 강제청산 아님(net 임계 도달 시에만 청산)', () => {
    const d = evaluateScalpExit(1000, 1005, '1519');
    expect(d.shouldExit).toBe(false);
  });
});

describe('진입 fee 허들 게이트', () => {
  it('정상 설정(순 +2% 익절·비용 0.31%) → 진입 허용', () => {
    const grossTp = grossTakeProfitThresholdPct(); // 2.31%
    expect(passesEntryFeeHurdle(grossTp, DEFAULT_ROUND_TRIP_COST_PCT)).toBe(true);
  });

  it('기대이동이 왕복비용+마진을 못 넘으면 진입 보류', () => {
    // gross 기대이동 0.4% ≤ 비용 0.31% + 마진 0.3% = 0.61% → 진입 차단
    expect(passesEntryFeeHurdle(0.4, DEFAULT_ROUND_TRIP_COST_PCT)).toBe(false);
  });

  it('경계: gross 기대이동 = 비용 + 최소마진 → 정확히 통과', () => {
    const boundary = DEFAULT_ROUND_TRIP_COST_PCT + ENTRY_FEE_HURDLE_MIN_MARGIN_PCT;
    expect(passesEntryFeeHurdle(boundary, DEFAULT_ROUND_TRIP_COST_PCT)).toBe(true);
    expect(passesEntryFeeHurdle(boundary - 0.0001, DEFAULT_ROUND_TRIP_COST_PCT)).toBe(false);
  });
});

describe('시각 게이트', () => {
  it('isForceExitTime: 15:20 포함 이후 true', () => {
    expect(isForceExitTime('1519')).toBe(false);
    expect(isForceExitTime('1520')).toBe(true);
    expect(isForceExitTime('1530')).toBe(true);
  });

  it('isPastEntryCutoff: 15:20 이후 신규 진입 금지', () => {
    expect(isPastEntryCutoff('1519')).toBe(false);
    expect(isPastEntryCutoff('1520')).toBe(true);
  });

  it('상수가 이슈 설계와 일치(순 기준 목표)', () => {
    expect(TAKE_PROFIT_PCT).toBe(2.0);
    expect(STOP_LOSS_PCT).toBe(-1.2);
    expect(FORCE_EXIT_HHMM).toBe('1520');
  });
});
