// backend/src/engine1-disclosure/insider-holdings/insider-holdings.scheduler.ts
// 내부자·대량보유 지분변동 정기 수집 스케줄러 (DAR-87).
// 공시/재무 수집 스케줄러와 별개 락 — 충돌 없음. 자연키 멱등이라 재실행 무손상.

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  InsiderHoldingsService,
  CollectInsiderResult,
} from './insider-holdings.service';

@Injectable()
export class InsiderHoldingsScheduler {
  private readonly logger = new Logger(InsiderHoldingsScheduler.name);
  private isRunning = false;

  constructor(private readonly service: InsiderHoldingsService) {}

  /**
   * 일 1회 우선종목 지분변동 수집 — 매일 03:30 (장 시작 전, 저호출 시간대).
   * DART 호출량 증가 대비 단일 실행 락 + 종목 간 레이트리밋(service 내부).
   */
  @Cron('30 3 * * *')
  async dailyCollect(): Promise<CollectInsiderResult | { skipped: true; reason: string }> {
    if (this.isRunning) {
      this.logger.warn('지분변동 수집 진행 중 — 일일 수집 건너뜀');
      return { skipped: true, reason: '이전 수집 진행 중' };
    }

    this.isRunning = true;
    try {
      this.logger.log('내부자·대량보유 지분변동 일일 수집 시작');
      return await this.service.collectBatch({ triggeredBy: 'CRON' });
    } finally {
      this.isRunning = false;
    }
  }
}
