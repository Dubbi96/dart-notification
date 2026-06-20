// backend/src/engine1-disclosure/pipeline/rawtext-offload.scheduler.ts
// DAR-395: 과거 rawText 객체 스토리지 오프로드 마이그레이션 스케줄러 — DB 경량화를 점진 진행.

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  RawTextOffloadDrainResult,
  RawTextOffloadDrainService,
} from './rawtext-offload-drain.service';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';
import { KST_TIMEZONE } from '../../common/time/kst';

/** 사이클 상태 — RAN(실행) | SKIPPED(겹침 가드 차단). */
export type RawTextOffloadCycleStatus = 'RAN' | 'SKIPPED';

/**
 * RawTextOffloadScheduler (DAR-395) — 과거 rawText 오프로드 마이그레이션 cron.
 *
 * ★카덴스: 매 10분(저트래픽 영향 적음, 1.7GB 를 며칠 내 점진 이전). 일 배치보다 자주 돌려
 *   백필 적체와 동시에 마이그레이션을 빠르게 수렴시킨다. 배치 상한(200)으로 부하 고정.
 * ★멱등: drainOnce 의 오프로드(동일 키 덮어쓰기)·컬럼 비우기(1회성)가 반복 무해.
 * ★throw 금지: cron 유지를 위해 예외 흡수(recorder 가 FAILED 기록).
 * ★겹침 가드: 드레인 1회가 끝날 때까지 다음 사이클 진입 차단.
 * ★AI 미개입·Engine5 무관(순수 인프라/용량 작업).
 */
@Injectable()
export class RawTextOffloadScheduler {
  private readonly logger = new Logger(RawTextOffloadScheduler.name);
  private isDraining = false;

  constructor(
    private readonly drainService: RawTextOffloadDrainService,
    @Optional() private readonly recorder?: CronRunRecorderService,
  ) {}

  /** 매 10분 과거 rawText 오프로드 드레인. */
  @Cron('*/10 * * * *', { timeZone: KST_TIMEZONE })
  async drainOffload(): Promise<RawTextOffloadCycleStatus> {
    if (this.isDraining) {
      this.logger.warn(
        '이전 rawText 오프로드 드레인이 진행 중 — 이번 사이클 SKIPPED(겹침 방지)',
      );
      return 'SKIPPED';
    }
    // 첫 await 이전 동기 락 획득(겹친 cron 가드).
    this.isDraining = true;

    const run = (): Promise<RawTextOffloadDrainResult> =>
      this.drainService.drainOnce();

    try {
      if (!this.recorder) {
        await run();
        return 'RAN';
      }
      await this.recorder.record(CRON_JOB_KEYS.RAWTEXT_OFFLOAD_DRAIN, run, {
        countOf: (r) => r.offloaded,
      });
      return 'RAN';
    } catch (error) {
      this.logger.error('rawText 오프로드 드레인 스케줄러 오류', error);
      return 'RAN';
    } finally {
      this.isDraining = false;
    }
  }
}
