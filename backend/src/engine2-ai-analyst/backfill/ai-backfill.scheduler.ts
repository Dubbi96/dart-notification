// backend/src/engine2-ai-analyst/backfill/ai-backfill.scheduler.ts
// DAR-379: AI 평가 백필 드레인 스케줄러 (매일) — 비용게이트 내 점진 드레인.

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AiBackfillDrainService,
  AiBackfillDrainResult,
} from './ai-backfill-drain.service';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';
import { KST_TIMEZONE } from '../../common/time/kst';

/**
 * 드레인 사이클 결과 상태.
 * - RAN: 이번 사이클이 실제 드레인을 수행함(예산 스킵 포함, 끝까지 진입).
 * - SKIPPED: 이전 드레인이 진행 중이라 겹침 가드가 즉시 차단함.
 */
export type DrainCycleStatus = 'RAN' | 'SKIPPED';

/**
 * AiBackfillScheduler (DAR-379) — 과거 미분석 공시 AI 평가 백필 일일 드레인 cron.
 *
 * ★카덴스: 매일 02:00 KST(저트래픽 시간대). 일 $1 예산을 일자별로 소진하며 적체를 점진 드레인.
 *   하루 한 배치만 발행 → 예산이 회복(KST 자정 리셋)될 때마다 다음 날 진척.
 *
 * ★멱등: drainOnce 는 aiAnalyzeJobId 자연키 + (rcpNo,task) 캐시 기반(반복 무해).
 * ★예산 안전: drainOnce 가 일/월 예산 소진 시 발행을 생략(skippedByBudget)하고,
 *   소비 비용은 AiCostLimitGuard 가 호출별로 하드 캡한다(폭주 불가).
 * ★throw 금지: cron 스케줄 유지를 위해 예외를 흡수한다(recorder 가 FAILED 기록).
 * ★겹침 가드: 드레인 1회가 끝날 때까지 다음 사이클 진입을 막는다(중복 발행 방지).
 */
@Injectable()
export class AiBackfillScheduler {
  private readonly logger = new Logger(AiBackfillScheduler.name);

  /** 겹침 가드 — 드레인 1회가 끝날 때까지 다음 사이클 진입을 막는다. */
  private isDraining = false;

  constructor(
    private readonly drainService: AiBackfillDrainService,
    // @Optional: CronHealthModule 미등록 환경(일부 테스트)에서도 동작. 미주입 시 기록만 생략.
    @Optional() private readonly recorder?: CronRunRecorderService,
  ) {}

  /** 매일 02:00 KST AI 평가 백필 드레인. */
  @Cron('0 2 * * *', { timeZone: KST_TIMEZONE })
  async drainBackfill(): Promise<DrainCycleStatus> {
    // 이전 사이클이 아직 진행 중이면 겹치지 않도록 즉시 스킵(중복 발행 방지).
    if (this.isDraining) {
      this.logger.warn('이전 AI 백필 드레인이 진행 중 — 이번 사이클 SKIPPED(겹침 방지)');
      return 'SKIPPED';
    }
    // ★주의: 첫 await 이전에 동기적으로 락을 잡아야 겹친 cron 이 가드를 통과하지 못한다.
    this.isDraining = true;

    this.logger.log('AI 평가 백필 드레인 스케줄러 실행');

    const run = (): Promise<AiBackfillDrainResult> =>
      this.drainService.drainOnce();

    try {
      if (!this.recorder) {
        await run();
        return 'RAN';
      }
      // DAR-110 연계: 마지막 성공시각/발행건수 기록(신선도 판정 입력).
      await this.recorder.record(CRON_JOB_KEYS.AI_BACKFILL_DRAIN, run, {
        countOf: (r) => r.enqueued,
      });
      return 'RAN';
    } catch (error) {
      this.logger.error('AI 평가 백필 드레인 스케줄러 오류', error);
      return 'RAN';
    } finally {
      // 성공·실패 무관 락 해제 — 다음 cron 이 정상 진입할 수 있어야 한다.
      this.isDraining = false;
    }
  }
}
