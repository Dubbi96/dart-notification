/**
 * PriceMoveAlertScheduler — 갭분석 W7: 관심종목 급변동 감시 장중 5분 틱.
 *
 * paper-simulation.scheduler.ts(DAR-366)와 동일 게이트 패턴:
 *   cron 시(hour) 9-15 까지 발화하되, 서비스가 정규장 종료(15:30) 게이트로 15:35~15:55 틱을
 *   스킵한다(cron 만으로 15:30 컷을 못 거니 메서드 게이트가 정본). 장외/주말/키 미설정/
 *   킬스위치(PRICE_MOVE_ALERT_ENABLED=false)는 무가동 스킵 — CronRunLog 미기록(스팸 0).
 *
 * ★조회·알림 계층 전용 — 스케줄러는 트리거만(매매·체결 결정 없음·AI 0). M10 측정 무오염.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PriceMoveAlertService, PriceMoveTickResult } from './price-move-alert.service';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';
import { KST_TIMEZONE } from '../../common/time/kst';

@Injectable()
export class PriceMoveAlertScheduler {
  private readonly logger = new Logger(PriceMoveAlertScheduler.name);

  constructor(
    private readonly service: PriceMoveAlertService,
    // @Optional: CronHealthModule 미등록 환경(일부 테스트)에서도 동작. 미주입 시 기록만 생략.
    @Optional() private readonly recorder?: CronRunRecorderService,
  ) {}

  /** 평일 09:00~15:55 매 5분(KST) — 실제 컷(15:30)·장외 스킵은 서비스 게이트가 정본. */
  @Cron('*/5 9-15 * * 1-5', { timeZone: KST_TIMEZONE })
  async runTick(): Promise<void> {
    const result: PriceMoveTickResult = await this.service.runTick();
    // 스킵 틱(장외·킬스위치·겹침)은 CronRunLog 를 더럽히지 않도록 기록하지 않는다.
    if (!result.ran) return;
    if (result.fired > 0) {
      this.logger.log(
        `[PriceMove][Cron] scanned=${result.scanned} fired=${result.fired} carried=${result.carried}`,
      );
    }
    if (!this.recorder) return;
    await this.recorder.record(CRON_JOB_KEYS.PRICE_MOVE_ALERT, async () => result, {
      countOf: (r) => r.fired,
    });
  }
}
