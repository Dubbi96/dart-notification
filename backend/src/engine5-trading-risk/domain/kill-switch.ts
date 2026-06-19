// Engine5 — Kill Switch + 자동 중단 조건 (M11, DAR-18 / DAR-350 영속화)
// AI 금지영역: Kill Switch 판정은 순수 Rule. AI 개입 0.

import { OnModuleInit } from '@nestjs/common';
import { AutoKillConditions, DEFAULT_AUTO_KILL_CONDITIONS } from './risk-check.types';
import {
  IKillSwitchStateRepository,
  PersistedKillSwitchState,
} from '../repositories/kill-switch-state.repository';

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
 * KillSwitchManager — Kill Switch 상태 관리 + DB 영속화 (DAR-350)
 *
 * 핵심(거짓 안전 교정): 발동 상태가 in-memory 전용이면 재시작 시 isActive 유실 →
 * 발동 중이었어도 재기동 후 주문이 통과하는 파국. 이를 막기 위해
 *   ① 부팅(onModuleInit) 시 DB에서 최신 상태를 복원
 *   ② activate/deactivate 시 DB에 전이를 기록
 *   ③ isActive=true면 운영자가 명시적으로 deactivate 하기 전까지 유지
 *      (checkRisk가 killSwitchActive=true를 단독 veto → 신규 주문 차단).
 *
 * 영속 레포가 없으면(repo 미주입) 순수 인메모리로 동작 — fixture 테스트·모의운용 호환.
 * 인메모리 `state`는 동기 read(isActive/getState)의 진실원이며, write 시 동기 갱신 후
 * 비동기로 DB에 반영한다(read 핫패스 무블로킹). 룰 로직(checkAutoKill/checkRisk) 불변.
 */
export class KillSwitchManager implements OnModuleInit {
  private state: KillSwitchState = {
    isActive: false,
    triggeredBy: 'SYSTEM',
  };

  constructor(private readonly repo?: IKillSwitchStateRepository) {}

  /** 부팅 시 DB 상태 복원. NestJS 라이프사이클 훅. */
  async onModuleInit(): Promise<void> {
    await this.load();
  }

  /**
   * load — DB에서 최신 영속 상태를 인메모리로 복원.
   * 레포 미주입(인메모리 모드)이거나 기록이 없으면 기본(비활성)을 유지.
   */
  async load(): Promise<void> {
    if (!this.repo) return;
    const persisted = await this.repo.loadLatest();
    if (!persisted) return;
    this.state = this.toState(persisted);
  }

  async activate(
    reason: string,
    triggeredBy: 'SYSTEM' | 'USER' = 'SYSTEM',
  ): Promise<void> {
    const activatedAt = new Date();
    // 동기 갱신 — await 없이도 즉시 isActive()가 참을 반환(차단 즉시 발효).
    this.state = {
      isActive: true,
      reason,
      triggeredBy,
      activatedAt,
    };
    if (this.repo) {
      await this.repo.append({
        isActive: true,
        reason,
        triggeredBy,
        activatedAt,
        deactivatedAt: null,
      });
    }
  }

  async deactivate(): Promise<void> {
    const deactivatedAt = new Date();
    this.state = {
      isActive: false,
      triggeredBy: 'USER',
    };
    if (this.repo) {
      await this.repo.append({
        isActive: false,
        reason: null,
        triggeredBy: 'USER',
        activatedAt: null,
        deactivatedAt,
      });
    }
  }

  getState(): KillSwitchState {
    return { ...this.state };
  }

  isActive(): boolean {
    return this.state.isActive;
  }

  /**
   * autoCheck — 조건 충족 시 자동으로 Kill Switch 활성화(+ DB 기록).
   */
  async autoCheck(
    input: AutoKillCheckInput,
    conditions: AutoKillConditions = DEFAULT_AUTO_KILL_CONDITIONS,
  ): Promise<AutoKillResult> {
    const result = checkAutoKill(input, conditions);
    if (result.shouldKill && !this.state.isActive) {
      await this.activate(result.reason ?? 'AUTO_KILL', 'SYSTEM');
    }
    return result;
  }

  // ─── 영속 상태 → 인메모리 상태 매핑 ────────────────────────────────
  private toState(persisted: PersistedKillSwitchState): KillSwitchState {
    return {
      isActive: persisted.isActive,
      reason: persisted.reason ?? undefined,
      triggeredBy: persisted.triggeredBy,
      activatedAt: persisted.activatedAt ?? undefined,
    };
  }
}
