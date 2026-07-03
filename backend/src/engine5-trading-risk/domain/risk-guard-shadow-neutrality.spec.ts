// Engine5 — RiskGuard SHADOW 무변경(neutrality) 증명 스펙 (DAR-496 · DoD 항목5)
//
// 수용 기준: "배선 전후로 측정 트랙의 진입 후보·수량·예약이 동일함" = SHADOW 모드에서 게이트가
//   진입 흐름에 영향 0. 네 진입 경로 모두 게이트 판정을 **오직** `if (gate.action === 'BLOCK') <스킵>`
//   로만 소비하므로(코드 계약), 측정 트랙이 절대 BLOCK 되지 않음을 증명하면 배선 전후 산출이 동일함이
//   구조적으로 보장된다. 아래는 그 불변식을 최악 입력으로 전수 확인한다.
import {
  evaluateRiskGuardEntry,
  resolveRiskGuardMode,
  RiskGuardTrack,
  RiskGuardEntryInput,
} from './risk-guard-gate';

const MEASUREMENT_TRACKS: RiskGuardTrack[] = [
  'paper-simulation',
  'philosophy-style',
  'strategy-forward',
  'intraday-scalp',
];

// 두 규칙(일일손실·현금)을 모두 극단 위반시키는 최악 입력.
const catastrophic = (
  track: RiskGuardTrack,
): RiskGuardEntryInput => ({
  track,
  mode: resolveRiskGuardMode(track, {}), // 환경 오버라이드 없이 기본 모드
  totalCapital: 10_000_000,
  dailyRealizedPnl: -9_999_999, // ≪ -2%
  availableCash: 0,
  entryBudget: 5_000_000, // ≫ 가용현금
});

describe('SHADOW 무변경 증명 (DoD 항목5)', () => {
  it('모든 측정 트랙은 기본 모드가 SHADOW (진입 차단 불가능의 전제)', () => {
    for (const track of MEASUREMENT_TRACKS) {
      expect(resolveRiskGuardMode(track, {})).toBe('SHADOW');
    }
  });

  it('측정 트랙은 두 규칙 동시 극단 위반에도 BLOCK 되지 않는다 → 진입 흐름 무변경', () => {
    for (const track of MEASUREMENT_TRACKS) {
      const d = evaluateRiskGuardEntry(catastrophic(track));
      // 핵심: action 은 SHADOW_VIOLATION(기록만) 이지 BLOCK 이 아니다.
      expect(d.action).not.toBe('BLOCK');
      expect(d.action).toBe('SHADOW_VIOLATION');
      // 위반은 감지·기록되지만(관측 가치), 호출측의 BLOCK 분기는 발화하지 않는다.
      expect(d.violations.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('대조군: 동일 입력이 ENFORCE 모드(코어)였다면 BLOCK — 게이트 자체는 정상 동작', () => {
    const d = evaluateRiskGuardEntry({
      ...catastrophic('dual-momentum-forward'),
      mode: 'ENFORCE',
    });
    expect(d.action).toBe('BLOCK');
  });

  it('ALLOW 경로: 위반 없으면 어느 트랙이든 ALLOW (게이트 통과 = 무개입)', () => {
    for (const track of MEASUREMENT_TRACKS) {
      const d = evaluateRiskGuardEntry({
        ...catastrophic(track),
        dailyRealizedPnl: 0,
        availableCash: 10_000_000,
        entryBudget: 1_000_000,
      });
      expect(d.action).toBe('ALLOW');
      expect(d.allowed).toBe(true);
    }
  });
});
