// IExitSignalRepository interface — M8 (DAR-12)
// AI 금지영역: Exit Score·트리거 저장은 순수 Rule 결과만. AI 개입 0.

import {
  ExitAction,
  ExitTriggerType,
  ExitScoreComponents,
} from '../domain/exit-engine.types';

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
