// Engine5 — KillSwitchState 리포지토리 인터페이스 (DAR-350)
// AI 금지영역: Kill Switch 상태 영속화. 순수 Rule 안전망, AI 개입 0.
//
// 킬스위치 상태를 DB에 영속화해 재시작 시 발동 상태가 유실되지 않도록 한다(거짓 안전 교정).
// 활성/해제마다 히스토리 행을 append 하고, 부팅 시 최신 행을 복원한다(감사로그 패턴 정렬).

export type KillSwitchTriggeredBy = 'SYSTEM' | 'USER';

/** DB에 영속되는 킬스위치 상태 1행 분량. */
export interface PersistedKillSwitchState {
  isActive: boolean;
  reason: string | null;
  triggeredBy: KillSwitchTriggeredBy;
  activatedAt: Date | null;
  deactivatedAt: Date | null;
}

export interface IKillSwitchStateRepository {
  /** 가장 최근 영속 상태를 반환. 한 번도 기록된 적 없으면 null(부팅 시 기본=비활성). */
  loadLatest(): Promise<PersistedKillSwitchState | null>;

  /** 상태 전이를 히스토리 행으로 append(불변 감사 추적). */
  append(state: PersistedKillSwitchState): Promise<void>;
}

/**
 * InMemoryKillSwitchStateRepository — fixture 테스트·모의운용용 인메모리 어댑터.
 * 동일 인스턴스를 두 매니저가 공유하면 "프로세스 재시작 후 복원" 시나리오를 재현할 수 있다.
 */
export class InMemoryKillSwitchStateRepository
  implements IKillSwitchStateRepository
{
  private readonly history: PersistedKillSwitchState[] = [];

  async loadLatest(): Promise<PersistedKillSwitchState | null> {
    if (this.history.length === 0) return null;
    return { ...this.history[this.history.length - 1] };
  }

  async append(state: PersistedKillSwitchState): Promise<void> {
    this.history.push({ ...state });
  }

  /** 테스트 보조 — 누적된 히스토리 길이. */
  size(): number {
    return this.history.length;
  }

  clear(): void {
    this.history.length = 0;
  }
}
