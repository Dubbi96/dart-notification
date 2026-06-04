// InMemoryExitSignalRepository — M8 (DAR-12)
// 테스트·개발용 인메모리 어댑터. AI 개입 0.

import {
  IExitSignalRepository,
  CreateExitSignalParams,
} from './exit-signal.repository';

let idCounter = 0;

export class InMemoryExitSignalRepository implements IExitSignalRepository {
  private readonly store: Array<
    { id: string } & CreateExitSignalParams & { exitAction: string }
  > = [];

  async save(params: CreateExitSignalParams): Promise<{ id: string }> {
    const id = `exit-signal-${++idCounter}`;
    this.store.push({ id, ...params, exitAction: params.exitAction });
    return { id };
  }

  async findLatestByPositionId(
    positionId: string,
  ): Promise<{ exitScore: number; exitAction: string } | null> {
    const found = this.store.filter((s) => s.positionId === positionId);
    if (found.length === 0) return null;
    const latest = found[found.length - 1];
    return { exitScore: latest.exitScore, exitAction: latest.exitAction };
  }

  clear(): void {
    this.store.length = 0;
    idCounter = 0;
  }
}
