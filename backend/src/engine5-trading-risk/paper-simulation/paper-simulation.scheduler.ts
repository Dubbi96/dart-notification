/**
 * PaperSimulationScheduler — 일일 모의운용 Cron (M10 모의운용, DAR-40)
 *
 * 장마감·시세수집(KRX 18:30) 이후 1회 실행하여 매수→스냅샷→Exit→지표 사이클을 돌린다.
 * AI 금지영역: 스케줄러는 트리거만 — 점수·체결 결정 없음.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PaperSimulationService, DailyCycleResult } from './paper-simulation.service';

@Injectable()
export class PaperSimulationScheduler {
  private readonly logger = new Logger(PaperSimulationScheduler.name);

  constructor(private readonly sim: PaperSimulationService) {}

  /** 평일 19:30 — KRX 일봉(18:30)·지수(18:45) 수집 이후 모의운용 1사이클 */
  @Cron('30 19 * * 1-5')
  async runDaily(): Promise<DailyCycleResult> {
    const tradeDate = this.todayBasDd();
    this.logger.log(`[PaperSim][Cron] 일일 모의운용 실행 tradeDate=${tradeDate}`);
    return this.sim.runDailyCycle(tradeDate);
  }

  private todayBasDd(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }
}
