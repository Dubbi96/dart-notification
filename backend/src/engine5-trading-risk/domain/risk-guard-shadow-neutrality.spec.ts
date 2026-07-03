// Engine5 — RiskGuard SHADOW 무변경(neutrality) 증명 스펙 (DAR-496 · DoD 항목5)
//
// 수용 기준: "배선 전후로 측정 트랙의 진입 후보·수량·예약이 동일함" = SHADOW 모드에서 게이트가
//   진입 흐름에 영향 0. 네 진입 경로 모두 게이트 판정을 **오직** `if (gate.action === 'BLOCK') <스킵>`
//   로만 소비하므로(코드 계약), 측정 트랙이 절대 BLOCK 되지 않음을 증명하면 배선 전후 산출이 동일함이
//   구조적으로 보장된다. 아래는 그 불변식을 최악 입력으로 전수 확인한다.
import {
  evaluateRiskGuardEntry,
  evaluateDrawdownCut,
  resolveRiskGuardMode,
  RiskGuardTrack,
  RiskGuardEntryInput,
  RiskGuardDrawdownInput,
} from './risk-guard-gate';
import { checkAutoKill, AutoKillCheckInput } from './kill-switch';
import {
  SHADOW_AUTO_KILL_CONDITIONS,
  countConsecutiveLosses,
} from './auto-kill-inputs';
import { DEFAULT_AUTO_KILL_CONDITIONS } from './risk-check.types';

const MEASUREMENT_TRACKS: RiskGuardTrack[] = [
  'paper-simulation',
  'philosophy-style',
  'strategy-forward',
  'intraday-scalp',
];

// 세 규칙(일일손실·월간손실·현금)을 모두 극단 위반시키는 최악 입력.
const catastrophic = (track: RiskGuardTrack): RiskGuardEntryInput => ({
  track,
  mode: resolveRiskGuardMode(track, {}), // 환경 오버라이드 없이 기본 모드
  totalCapital: 10_000_000,
  dailyRealizedPnl: -9_999_999, // ≪ -2%
  monthlyRealizedPnl: -9_999_999, // ≪ -10% (P21·DAR-501)
  availableCash: 0,
  entryBudget: 5_000_000, // ≫ 가용현금
});

describe('SHADOW 무변경 증명 (DoD 항목5)', () => {
  it('모든 측정 트랙은 기본 모드가 SHADOW (진입 차단 불가능의 전제)', () => {
    for (const track of MEASUREMENT_TRACKS) {
      expect(resolveRiskGuardMode(track, {})).toBe('SHADOW');
    }
  });

  it('측정 트랙은 세 규칙 동시 극단 위반에도 BLOCK 되지 않는다 → 진입 흐름 무변경', () => {
    for (const track of MEASUREMENT_TRACKS) {
      const d = evaluateRiskGuardEntry(catastrophic(track));
      // 핵심: action 은 SHADOW_VIOLATION(기록만) 이지 BLOCK 이 아니다.
      expect(d.action).not.toBe('BLOCK');
      expect(d.action).toBe('SHADOW_VIOLATION');
      // 위반은 감지·기록되지만(관측 가치), 호출측의 BLOCK 분기는 발화하지 않는다.
      expect(d.violations.length).toBeGreaterThanOrEqual(1);
      // P21(DAR-501): 월간손실 극단 위반도 SHADOW 에선 기록만(차단 0).
      expect(d.violations.map((v) => v.code)).toContain('MONTHLY_LOSS');
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
        monthlyRealizedPnl: 0,
        availableCash: 10_000_000,
        entryBudget: 1_000_000,
      });
      expect(d.action).toBe('ALLOW');
      expect(d.allowed).toBe(true);
    }
  });
});

// DAR-497(P19): 드로다운 컷도 동일 불변식 — 측정 트랙은 극단 드로다운에도 절대 BLOCK 되지 않는다.
//   (SHADOW 중립성 스펙 확장 — DoD 항목5 / 이슈 요건4.)
const catastrophicDrawdown = (track: RiskGuardTrack): RiskGuardDrawdownInput => ({
  track,
  mode: resolveRiskGuardMode(track, {}),
  highWaterMark: 10_000_000,
  currentEquity: 100_000, // −99% 드로다운(극단 위반)
});

describe('SHADOW 무변경 증명 — 드로다운 컷 (DoD 항목5 / 요건4)', () => {
  it('측정 트랙은 −99% 드로다운에도 BLOCK 되지 않는다 → 매매 행동 무변경', () => {
    for (const track of MEASUREMENT_TRACKS) {
      const d = evaluateDrawdownCut(catastrophicDrawdown(track));
      expect(d.action).not.toBe('BLOCK');
      expect(d.action).toBe('SHADOW_VIOLATION');
      expect(d.violations.map((v) => v.code)).toContain('DRAWDOWN_CUT');
    }
  });

  it('대조군: 동일 극단 드로다운이 ENFORCE(코어)였다면 BLOCK — 게이트 정상 동작', () => {
    const d = evaluateDrawdownCut({
      ...catastrophicDrawdown('dual-momentum-forward'),
      mode: 'ENFORCE',
    });
    expect(d.action).toBe('BLOCK');
  });
});

// DAR-502(P20): 자동 킬스위치 SHADOW 계측 중립성 — 권고가 사이클 산출/매매에 영향 0.
//   (SHADOW 중립성 스펙 확장 — DoD 항목5 / 이슈 요건2·5.)
describe('SHADOW 중립성 증명 — 자동 킬스위치 계측 (DoD 항목5 / 요건2·5)', () => {
  it('임계 무변경: SHADOW 계측 조건 = frozen DEFAULT (magic 임계 미도입)', () => {
    expect(SHADOW_AUTO_KILL_CONDITIONS).toEqual(DEFAULT_AUTO_KILL_CONDITIONS);
    // 시장급락 레그는 DEFAULT 에서 0(비활성) — 판정 무변경, raw 값만 관측용 기록.
    expect(SHADOW_AUTO_KILL_CONDITIONS.marketDropPct).toBe(0);
  });

  it('checkAutoKill 은 순수 권고만 반환(activate 부작용 없음) — 동일 입력 결정론적', () => {
    const worst: AutoKillCheckInput = {
      consecutiveLossCount: 99, // 극단 발동 입력
      marketDropPct: -0.9,
      apiErrorCount: 99,
    };
    const a = checkAutoKill(worst, SHADOW_AUTO_KILL_CONDITIONS);
    const b = checkAutoKill(worst, SHADOW_AUTO_KILL_CONDITIONS);
    // 권고는 하되(shouldKill=true) 반환값은 순수 데이터 — 상태 전이·발동 없음.
    expect(a.shouldKill).toBe(true);
    expect(a).toEqual(b); // 결정론적(멱등) — 부작용 없음의 방증
    expect(Object.keys(a).sort()).toEqual(['reason', 'shouldKill', 'triggerCode']);
  });

  it('입력 산출은 read-only 순수 함수 — 인자 배열 불변(부작용 없음)', () => {
    const pnls = [-1, -2, -3, 4, -5];
    const snapshot = [...pnls];
    countConsecutiveLosses(pnls);
    expect(pnls).toEqual(snapshot); // 입력 미변형
  });
});
