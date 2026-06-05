// IExitSignalRepository interface — M8 (DAR-12)
// AI 금지영역: Exit Score·트리거 저장은 순수 Rule 결과만. AI 개입 0.
// 구현체: 인메모리(테스트·폴백) + Prisma(영속화, DAR-34).
// DI 바인딩은 EXIT_SIGNAL_REPOSITORY 토큰으로 주입한다.

import {
  ExitAction,
  ExitTriggerType,
  ExitScoreComponents,
} from '../domain/exit-engine.types';

/** IExitSignalRepository DI 주입 토큰 */
export const EXIT_SIGNAL_REPOSITORY = 'IExitSignalRepository';

export interface CreateExitSignalParams {
  positionId: string;
  checkTime: string;
  components: ExitScoreComponents;
  exitScore: number;
  exitAction: ExitAction;
  triggerTypes: ExitTriggerType[];
  primaryTrigger: ExitTriggerType | null;
  scoreDetail: Record<string, unknown>;
  triggerRcpNo?: string;
}

export interface IExitSignalRepository {
  save(params: CreateExitSignalParams): Promise<{ id: string }>;
  findLatestByPositionId(
    positionId: string,
  ): Promise<{ exitScore: number; exitAction: string } | null>;
}
