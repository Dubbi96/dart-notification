// Engine5 — Kill Switch + 자동 중단 조건 (M11, DAR-18)
// AI 금지영역: Kill Switch 판정은 순수 Rule. AI 개입 0.

import { AutoKillConditions, DEFAULT_AUTO_KILL_CONDITIONS } from './risk-check.types';

export interface KillSwitchState {
  isActive: boolean;
  reason?: string;
  triggeredBy: 'SYSTEM' | 'USER';
  activatedAt?: Date;
}

export interface AutoKillCheckInput {
  consecutiveLossCount: number;  // 연속 손실 횟수
  marketDropPct: number;         // 시장 지수 변동율 (음수 = 하락)
  apiErrorCount: number;         // API 오류 누적 횟수
}

export interface AutoKillResult {
  shouldKill: boolean;
  reason?: string;
  triggerCode?: 'CONSECUTIVE_LOSS' | 'MARKET_DROP' | 'API_ERROR';
}

/**
 * checkAutoKill — 자동 Kill Switch 조건 검사 (순수 함수)
 * 연속손실·시장급락·API오류 중 하나라도 임계치 초과 시 Kill 권고.
 */
export function checkAutoKill(
  input: AutoKillCheckInput,
  conditions: AutoKillConditions = DEFAULT_AUTO_KILL_CONDITIONS,
): AutoKillResult {
  // 1. 연속 손실
  if (input.consecutiveLossCount >= conditions.maxConsecutiveLoss) {
    return {
      shouldKill: true,
      triggerCode: 'CONSECUTIVE_LOSS',
      reason: `연속 손실 ${input.consecutiveLossCount}회 (임계: ${conditions.maxConsecutiveLoss}회)`,
    };
  }

  // 2. 시장 급락 (marketDropPct < 0)
  if (
    conditions.marketDropPct !== 0 &&
    input.marketDropPct <= conditions.marketDropPct
  ) {
    return {
      shouldKill: true,
      triggerCode: 'MARKET_DROP',
      reason: `시장 급락 감지: ${(input.marketDropPct * 100).toFixed(2)}% (임계: ${(conditions.marketDropPct * 100).toFixed(0)}%)`,
    };
  }

  // 3. API 오류 누적
  if (input.apiErrorCount >= conditions.maxApiErrors) {
    return {
      shouldKill: true,
      triggerCode: 'API_ERROR',
      reason: `API 오류 누적 ${input.apiErrorCount}회 (임계: ${conditions.maxApiErrors}회)`,
    };
  }

  return { shouldKill: false };
}

/**
 * KillSwitchManager — Kill Switch 상태 관리 (인메모리)
 * 실 DB 연결 전 fixture 테스트 및 모의운용용.
 */
export class KillSwitchManager {
  private state: KillSwitchState = {
    isActive: false,
    triggeredBy: 'SYSTEM',
  };

  activate(reason: string, triggeredBy: 'SYSTEM' | 'USER' = 'SYSTEM'): void {
    this.state = {
      isActive: true,
      reason,
      triggeredBy,
      activatedAt: new Date(),
    };
  }

  deactivate(): void {
    this.state = {
      isActive: false,
      triggeredBy: 'USER',
    };
  }

  getState(): KillSwitchState {
    return { ...this.state };
  }

  isActive(): boolean {
    return this.state.isActive;
  }

  /**
   * autoCheck — 조건 충족 시 자동으로 Kill Switch 활성화
   */
  autoCheck(
    input: AutoKillCheckInput,
    conditions: AutoKillConditions = DEFAULT_AUTO_KILL_CONDITIONS,
  ): AutoKillResult {
    const result = checkAutoKill(input, conditions);
    if (result.shouldKill && !this.state.isActive) {
      this.activate(result.reason ?? 'AUTO_KILL', 'SYSTEM');
    }
    return result;
  }
}
