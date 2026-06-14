// backend/src/engine1-disclosure/insider-holdings/insider-holdings.scheduler.ts
// 내부자·대량보유 지분변동 정기 수집 스케줄러 (DAR-87).
// 공시/재무 수집 스케줄러와 별개 락 — 충돌 없음. 자연키 멱등이라 재실행 무손상.

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  InsiderHoldingsService,
  CollectInsiderResult,
} from './insider-holdings.service';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';
import { KST_TIMEZONE } from '../../common/time/kst';

type DailyCollectResult =
  | CollectInsiderResult
  | { skipped: true; reason: string };

@Injectable()
export class InsiderHoldingsScheduler {
  private readonly logger = new Logger(InsiderHoldingsScheduler.name);
  private isRunning = false;

  constructor(
    private readonly service: InsiderHoldingsService,
    // @Optional: CronHealthModule 미등록 환경(일부 테스트)에서도 동작. 미주입 시 기록만 생략.
    @Optional() private readonly recorder?: CronRunRecorderService,
  ) {}

  /**
   * 일 1회 우선종목 지분변동 수집 — 매일 03:30(KST) (장 시작 전, 저호출 시간대).
   * DART 호출량 증가 대비 단일 실행 락 + 종목 간 레이트리밋(service 내부).
   */
  @Cron('30 3 * * *', { timeZone: KST_TIMEZONE })
  async dailyCollect(): Promise<DailyCollectResult> {
    const run = async (): Promise<DailyCollectResult> => {
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
    };

    if (!this.recorder) return run();
    // DAR-110: 마지막 성공시각/저장건수 기록(신선도 판정 입력). 락 조기반환은 SKIPPED.
    return this.recorder.record<DailyCollectResult>(
      CRON_JOB_KEYS.INSIDER_DAILY,
      run,
      {
        isSkipped: (r) => 'skipped' in r,
        countOf: (r) => ('skipped' in r ? 0 : r.saved),
      },
    );
  }
}
