// InMemoryExitCheckScheduler — M8 (DAR-12)
// 테스트·개발용 스케줄러 어댑터. AI 개입 0.

import { IExitCheckScheduler } from './exit-check-scheduler.interface';
import { ExitEngineService } from './exit-engine.service';

export class InMemoryExitCheckScheduler implements IExitCheckScheduler {
  private readonly runLog: string[] = [];

  constructor(private readonly exitEngineService: ExitEngineService) {}

  async runPreMarketCheck(): Promise<void> {
    this.runLog.push('PRE_MARKET');
    await this.exitEngineService.checkAllPositions('PRE_MARKET');
  }

  async runIntradayCheck(): Promise<void> {
    this.runLog.push('INTRADAY');
    await this.exitEngineService.checkAllPositions('INTRADAY');
  }

  async runPostMarketCheck(): Promise<void> {
    this.runLog.push('POST_MARKET');
    await this.exitEngineService.checkAllPositions('POST_MARKET');
  }

  getRunLog(): string[] {
    return [...this.runLog];
  }

  clear(): void {
    this.runLog.length = 0;
  }
}
