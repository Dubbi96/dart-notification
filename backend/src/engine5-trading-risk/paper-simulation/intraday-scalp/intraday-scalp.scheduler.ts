/**
 * IntradayScalpScheduler — 분봉 단타 모의전략 Cron (DAR-411)
 *
 * - 진입·청산 평가: 정규장 매 10분(분봉수집기 `*​/10` 직후 +2분 오프셋)에 유니버스→진입→청산.
 *   서비스가 정규장(09:00~15:30)·진입마감(15:20) 게이트를 정본으로 강제(cron 은 발화만).
 * - 15:20 전량 강제청산: 별도 잡 — 당일 청산 보장(오버나잇 금지).
 * AI 금지영역: 스케줄러는 트리거만 — 점수·체결·청산 결정 없음.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { IntradayScalpService } from './intraday-scalp.service';
import { CronRunRecorderService } from '../../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../../cron-health/cron-health.jobs';
import { KST_TIMEZONE } from '../../../common/time/kst';

@Injectable()
export class IntradayScalpScheduler {
  private readonly logger = new Logger(IntradayScalpScheduler.name);

  constructor(
    private readonly scalp: IntradayScalpService,
    @Optional() private readonly recorder?: CronRunRecorderService,
  ) {}

  /**
   * 평일 09:02~15:52 매 10분(KST) — 분봉수집기(`*​/10`) 직후 +2분 오프셋.
   *   진입 평가 → 청산 평가 순. 정규장/진입마감 게이트는 서비스가 강제(장외 틱은 스킵·무기록).
   */
  @Cron('2-59/10 9-15 * * 1-5', { timeZone: KST_TIMEZONE })
  async runCycle(): Promise<void> {
    const run = async () => {
      const entry = await this.scalp.runEntryCycle();
      const exit = await this.scalp.runExitCycle();
      return { entry, exit };
    };
    if (!this.recorder) {
      await run();
      return;
    }
    const result = await run();
    // 스킵(장외) 틱은 CronRunLog 를 더럽히지 않도록 기록 생략 — 실제 평가가 돈 틱만 기록.
    if (!result.entry.ran && !result.exit.ran) return;
    await this.recorder.record(CRON_JOB_KEYS.INTRADAY_SCALP, async () => result, {
      countOf: (r) => r.entry.entered + r.exit.exited,
    });
  }

  /** 평일 15:20(KST) — 전량 강제청산(당일 청산 보장). */
  @Cron('20 15 * * 1-5', { timeZone: KST_TIMEZONE })
  async runForceClose(): Promise<void> {
    const result = await this.scalp.forceCloseAll();
    this.logger.log(`[Scalp][Cron] 15:20 강제청산 ${result.exited}건`);
  }
}
