// Exit Engine Service — M8 (DAR-12)
// AI 금지영역: Exit Score·트리거·비중은 순수 Rule. AI 개입 0.

import {
  CheckTime,
  PositionSnapshot,
  TechnicalSnapshot,
  ThesisSnapshot,
  DisclosureEvent,
  ExitScoreResult,
} from '../domain/exit-engine.types';
import { calculateExitScore } from '../domain/exit-score.calculator';
import { IExitSignalRepository } from '../repositories/exit-signal.repository';

export interface IPositionProvider {
  getOpenPositions(): Promise<PositionSnapshot[]>;
  getTechnicalSnapshot(stockCode: string): Promise<TechnicalSnapshot>;
  getThesisSnapshot(positionId: string): Promise<ThesisSnapshot | null>;
  getDisclosureEvents(
    corpCode: string,
    since: Date,
  ): Promise<DisclosureEvent[]>;
}

export class ExitEngineService {
  constructor(
    private readonly positionProvider: IPositionProvider,
    private readonly exitSignalRepo: IExitSignalRepository,
  ) {}

  async checkAllPositions(checkTime: CheckTime): Promise<ExitScoreResult[]> {
    const positions = await this.positionProvider.getOpenPositions();
    const results: ExitScoreResult[] = [];

    for (const pos of positions) {
      const result = await this.checkPosition(pos, checkTime);
      results.push(result);
    }

    return results;
  }

  async checkPosition(
    pos: PositionSnapshot,
    checkTime: CheckTime,
  ): Promise<ExitScoreResult> {
    const tech = await this.positionProvider.getTechnicalSnapshot(pos.stockCode);
    const thesis = await this.positionProvider.getThesisSnapshot(pos.id);
    const since = new Date(pos.entryDate);
    const events = await this.positionProvider.getDisclosureEvents(
      pos.corpCode,
      since,
    );

    const result = calculateExitScore(pos, tech, thesis, events);

    await this.exitSignalRepo.save({
      positionId: pos.id,
      checkTime,
      components: result.components,
      exitScore: result.exitScore,
      exitAction: result.exitAction,
      triggerTypes: result.triggerTypes,
      primaryTrigger: result.primaryTrigger,
      scoreDetail: {
        components: result.components,
        triggerTypes: result.triggerTypes,
      },
    });

    return result;
  }
}
