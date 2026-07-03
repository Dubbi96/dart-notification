// Engine5 — RiskGuard 공용 진입 게이트 (M11 견고화 W2·P18, DAR-496)
//
// AI 금지영역: 게이트 판정은 순수 Rule(수식/파라미터). AI/LLM/engine2 개입 절대 0.
// 이 파일에서 AI/LLM/engine2 import 는 절대 금지 (risk-guard 훅이 차단).
//
// 배경(갭 A1·A5): DAILY_LOSS 순수 룰(risk-check.service.ts)은 분봉 단타에서만 진입 강제되고,
//   시스템 모의·철학·전략 forward 경로에는 미배선. 전략 forward 진입 루프에는 현금 가드도 없다.
//   본 게이트는 **일일손실 한도 + 현금 불변식(cash≥0, DAR-426 패턴)** 2종을 트랙 컨텍스트만 받는
//   순수 함수로 추출해 전 트랙에서 동일하게 호출할 수 있게 한다.
//
// 모드(트랙별):
//   - 측정 트랙(시스템 모의·철학·전략 forward·분봉 단타)은 **SHADOW** — 위반을 기록만 하고 차단 0.
//     (M10 30일 측정 중 — 측정 트랙 매매 행동 무변경이 절대 조건.)
//   - 듀얼모멘텀 코어 forward 는 처음부터 **ENFORCE** — 위반 시 진입 차단(측정 대상 아님).
//   ★불변식: `evaluateRiskGuardEntry` 는 mode==='ENFORCE' 일 때만 BLOCK 을 반환한다.
//     따라서 SHADOW 트랙에서는 절대 BLOCK 이 나오지 않아 진입 흐름이 바뀌지 않는다(구조적 무변경 보증).

import { DEFAULT_RISK_LIMITS } from './risk-check.types';
import { computeMaxDrawdownPct } from '../../engine4-portfolio-exit/portfolio/mdd.util';

/** 게이트가 배선되는 트랙 식별자. */
export type RiskGuardTrack =
  | 'paper-simulation' // 시스템 모의운용(SHADOW)
  | 'philosophy-style' // 철학 스타일 4종(SHADOW)
  | 'strategy-forward' // 전략 forward 4종(SHADOW)
  | 'intraday-scalp' // 분봉 단타(SHADOW — 기존 checkRisk 하드룰 유지, 게이트는 로그만)
  | 'dual-momentum-forward'; // 듀얼모멘텀 코어 forward(ENFORCE)

/** 트랙별 운영 모드. SHADOW=기록만(차단 0) · ENFORCE=위반 시 차단. */
export type RiskGuardMode = 'SHADOW' | 'ENFORCE';

/**
 * 게이트 위반 코드.
 *   - P18(DAR-496): DAILY_LOSS(일일손실)·CASH_GUARD(현금 불변식) — 진입 게이트.
 *   - P19(DAR-497): DRAWDOWN_CUT(고점 대비 −15% 드로다운 컷) — 계좌 레벨 게이트.
 * (월간 한도·자동 킬은 후속 P20~P21.)
 */
export type RiskGuardViolationCode = 'DAILY_LOSS' | 'CASH_GUARD' | 'DRAWDOWN_CUT';

/** 게이트 판정 액션. ALLOW=통과 · SHADOW_VIOLATION=위반이나 기록만 · BLOCK=위반으로 차단. */
export type RiskGuardAction = 'ALLOW' | 'SHADOW_VIOLATION' | 'BLOCK';

export interface RiskGuardViolation {
  code: RiskGuardViolationCode;
  message: string;
  details: Record<string, number>;
}

/** 순수 게이트 입력 — 트랙 컨텍스트(진입 확정 직전 스냅샷). */
export interface RiskGuardEntryInput {
  track: RiskGuardTrack;
  mode: RiskGuardMode;
  totalCapital: number; // 트랙 가상원금(KRW)
  dailyRealizedPnl: number; // 당일 실현손익(음수=손실). 손실한도 판정 기준.
  availableCash: number; // 진입 직전 가용현금(KRW)
  entryBudget: number; // 이번 진입 예산(체결 예상 진입원가, KRW)
  killSwitchActive?: boolean; // 킬스위치 상태(로그 통합용 — 차단 자체는 각 트랙이 개별 처리)
  corpCode?: string; // 진입 대상 식별(로그/알림 컨텍스트)
  stockCode?: string;
}

export interface RiskGuardDecision {
  action: RiskGuardAction;
  track: RiskGuardTrack;
  mode: RiskGuardMode;
  violations: RiskGuardViolation[];
  /** 위반 없이 통과했는가(ALLOW). */
  allowed: boolean;
}

/**
 * 트랙별 기본 모드. 측정 트랙은 SHADOW(M10 측정 보호), 코어는 ENFORCE.
 * ★측정 트랙 기본값 SHADOW 는 본 이슈의 수용 기준이다(플립은 M10 졸업 후 사용자 승인 — 룰북 §8.5).
 */
export const DEFAULT_RISK_GUARD_MODES: Record<RiskGuardTrack, RiskGuardMode> = {
  'paper-simulation': 'SHADOW',
  'philosophy-style': 'SHADOW',
  'strategy-forward': 'SHADOW',
  'intraday-scalp': 'SHADOW',
  'dual-momentum-forward': 'ENFORCE',
};

/**
 * 트랙 모드 해석 — 환경변수 `RISK_GUARD_MODE_<TRACK>`(TRACK=UPPER_SNAKE)로 오버라이드 가능.
 *   예: `RISK_GUARD_MODE_PAPER_SIMULATION=ENFORCE`.
 * ★ENFORCE 플립은 **코드 변경 없이** 환경설정만으로 가능하다. 단, 측정 트랙 플립은 M10 졸업
 *   측정 완료 + 사용자 승인 전까지 금지(룰북 §8.5). 잘못된 값은 무시하고 기본값을 쓴다(순수·안전).
 */
export function resolveRiskGuardMode(
  track: RiskGuardTrack,
  env: NodeJS.ProcessEnv = process.env,
): RiskGuardMode {
  const key = `RISK_GUARD_MODE_${track.replace(/-/g, '_').toUpperCase()}`;
  const raw = (env[key] ?? '').trim().toUpperCase();
  if (raw === 'ENFORCE' || raw === 'SHADOW') return raw;
  return DEFAULT_RISK_GUARD_MODES[track];
}

/** 일일손실 한도(음수, 기본 -0.02 = -2%) — Risk 하드룰 SSOT(risk-check.types) 재사용. */
export const RISK_GUARD_DAILY_LOSS_MAX_PCT = DEFAULT_RISK_LIMITS.dailyLossMaxPct;

/**
 * evaluateRiskGuardEntry — 순수 함수. 트랙 컨텍스트를 받아 일일손실·현금 2종 위반을 판정한다.
 *
 * 규칙:
 *   1) DAILY_LOSS  : dailyRealizedPnl / totalCapital < dailyLossMaxPct(-2%)  → 위반
 *   2) CASH_GUARD  : availableCash − entryBudget < 0 (cash≥0 불변식 위배)     → 위반
 *
 * 액션:
 *   - 위반 0                         → ALLOW
 *   - 위반 ≥1 && mode==='SHADOW'     → SHADOW_VIOLATION (기록만, 차단 0)
 *   - 위반 ≥1 && mode==='ENFORCE'    → BLOCK (진입 차단)
 *
 * ★불변식: BLOCK 은 mode==='ENFORCE' 일 때만 반환된다 → SHADOW 트랙은 절대 차단되지 않는다.
 * ★side-effect 0 (영속·알림은 RiskGuardService 소관). AI 개입 0.
 */
export function evaluateRiskGuardEntry(input: RiskGuardEntryInput): RiskGuardDecision {
  const violations: RiskGuardViolation[] = [];

  // 1) 일일손실 한도 — totalCapital>0 일 때만 판정(0/음수 자본은 판정 불가 → 스킵).
  if (input.totalCapital > 0) {
    const dailyLossPct = input.dailyRealizedPnl / input.totalCapital;
    if (dailyLossPct < RISK_GUARD_DAILY_LOSS_MAX_PCT) {
      violations.push({
        code: 'DAILY_LOSS',
        message: `일일손실 한도 초과: ${(dailyLossPct * 100).toFixed(2)}% < 허용 ${(RISK_GUARD_DAILY_LOSS_MAX_PCT * 100).toFixed(0)}%`,
        details: {
          dailyRealizedPnl: input.dailyRealizedPnl,
          totalCapital: input.totalCapital,
          actualPct: dailyLossPct,
          limitPct: RISK_GUARD_DAILY_LOSS_MAX_PCT,
        },
      });
    }
  }

  // 2) 현금 불변식(cash≥0) — 진입 예산이 가용현금을 넘으면 위반(DAR-426 패턴).
  const cashAfter = input.availableCash - input.entryBudget;
  if (cashAfter < 0) {
    violations.push({
      code: 'CASH_GUARD',
      message: `현금 불변식 위배: 가용현금 ${input.availableCash.toFixed(0)} − 진입예산 ${input.entryBudget.toFixed(0)} = ${cashAfter.toFixed(0)} < 0`,
      details: {
        availableCash: input.availableCash,
        entryBudget: input.entryBudget,
        cashAfter,
      },
    });
  }

  return decideRiskGuardAction(input.track, input.mode, violations);
}

// ─── P19(DAR-497): 드로다운 컷 — 고점(HWM) 대비 −15% 계좌 레벨 게이트 ──────────────

/**
 * 드로다운 컷 임계(음수, 기본 −0.15 = −15%). **frozen 상수** — graduation-gates G6(MDD 한도 −15%,
 * cc-mvp-definition §9 백테스트 게이트) 및 룰북 8-6(-15~20% 컷)과 정합. 값 변경은 §8.1 3게이트 필수.
 * ★정합 보증: `risk-guard-gate.spec.ts` 가 `GRADUATION_THRESHOLDS.mddLimitPct` 와 동치(×100)를 회귀로 봉인.
 */
export const RISK_GUARD_DRAWDOWN_CUT_MAX_PCT = -0.15;

/** 드로다운 컷 순수 입력 — 계좌 고점(HWM)과 현재 총자산 스냅샷. */
export interface RiskGuardDrawdownInput {
  track: RiskGuardTrack;
  mode: RiskGuardMode;
  /** 계좌 고점(총자산, forward-only max). ≤0 이면 판정 불가(스킵). */
  highWaterMark: number;
  /** 현재 총자산(현금 + 평가). */
  currentEquity: number;
  killSwitchActive?: boolean; // 로그 컨텍스트(차단 자체는 코어 트랙이 킬스위치로 처리)
}

/**
 * evaluateDrawdownCut — 순수 함수. 계좌 고점 대비 드로다운이 −15%(G6·frozen) 이하면 DRAWDOWN_CUT.
 *
 * 규칙: drawdownPct = computeMaxDrawdownPct([highWaterMark, currentEquity])  (engine4 mdd.util 재사용)
 *        → highWaterMark ≥ currentEquity 면 (HWM−현재)/HWM 를 음수%로, 현재>HWM(신고점)이면 0.
 *        drawdownPct ≤ RISK_GUARD_DRAWDOWN_CUT_MAX_PCT×100(−15) → 위반.
 *
 * 액션(진입 게이트와 동일 불변식):
 *   - 위반 0                      → ALLOW
 *   - 위반 && mode==='SHADOW'      → SHADOW_VIOLATION (기록만, 차단 0)
 *   - 위반 && mode==='ENFORCE'     → BLOCK (코어 트랙 → 호출측이 킬스위치 REDUCE_ONLY 발동)
 *
 * ★불변식: BLOCK 은 mode==='ENFORCE' 일 때만 반환된다 → SHADOW 측정 트랙은 극단 드로다운에도 절대
 *   차단되지 않는다(매매 행동 무변경·M10 클록 보호). side-effect 0 · AI 개입 0.
 */
export function evaluateDrawdownCut(input: RiskGuardDrawdownInput): RiskGuardDecision {
  const violations: RiskGuardViolation[] = [];

  // 고점이 유효(>0)할 때만 판정 — 미관측/0 자본은 드로다운 정의 불가(안전 스킵).
  if (input.highWaterMark > 0) {
    // computeMaxDrawdownPct 는 시계열 peak-to-trough 를 음수%로 반환. [고점, 현재] 2점이면
    // '고점 대비 현재 드로다운'과 동치다(현재가 신고점이면 peak 갱신 → 0).
    const drawdownPct = computeMaxDrawdownPct([input.highWaterMark, input.currentEquity]);
    const limitPct = RISK_GUARD_DRAWDOWN_CUT_MAX_PCT * 100;
    if (drawdownPct <= limitPct) {
      violations.push({
        code: 'DRAWDOWN_CUT',
        message: `드로다운 컷: 고점 대비 ${drawdownPct.toFixed(2)}% ≤ 한도 ${limitPct.toFixed(0)}% (고점 ${input.highWaterMark.toFixed(0)} → 현재 ${input.currentEquity.toFixed(0)})`,
        details: {
          highWaterMark: input.highWaterMark,
          currentEquity: input.currentEquity,
          drawdownPct,
          limitPct,
        },
      });
    }
  }

  return decideRiskGuardAction(input.track, input.mode, violations);
}

/**
 * decideRiskGuardAction — 위반 목록 → 액션(공통). BLOCK 은 mode==='ENFORCE' 일 때만.
 * 진입 게이트·드로다운 컷이 공유하는 SHADOW 무차단 불변식의 단일 판정 지점.
 */
function decideRiskGuardAction(
  track: RiskGuardTrack,
  mode: RiskGuardMode,
  violations: RiskGuardViolation[],
): RiskGuardDecision {
  const allowed = violations.length === 0;
  let action: RiskGuardAction;
  if (allowed) {
    action = 'ALLOW';
  } else if (mode === 'ENFORCE') {
    action = 'BLOCK';
  } else {
    action = 'SHADOW_VIOLATION';
  }
  return { action, track, mode, violations, allowed };
}
