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
import { isHeavyCollectionWindow } from '../common/heavy-collection-window';

/**
 * 사이클 상태.
 * - RAN           : 실제 오프로드 드레인 수행.
 * - SKIPPED       : 겹침 가드 차단(이전 사이클 진행 중).
 * - WINDOW_SKIPPED: DAR-503 헤비 수집 창 밖(주중) — 정책상 정지.
 */
export type RawTextOffloadCycleStatus = 'RAN' | 'SKIPPED' | 'WINDOW_SKIPPED';

/**
 * RawTextOffloadScheduler (DAR-395) — 과거 rawText 오프로드 마이그레이션 cron.
 *
 * ★카덴스: 매 10분 발화(env 오버라이드 유연성 유지). 단, DAR-503 로 실제 드레인은 **주말 창**에만
 *   수행한다 — 대형 스캔이 주중 DB 커넥션 풀·DART 쿼터와 경쟁하던 것을 해소. 주중 사이클은 즉시
 *   WINDOW_SKIPPED(드레인 미수행) + CronRunLog SKIPPED 기록(크론 생존 표면화).
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

  /** 매 10분 발화 — 주말 창에서만 과거 rawText 오프로드 드레인(DAR-503). */
  @Cron('*/10 * * * *', { timeZone: KST_TIMEZONE })
  async drainOffload(now: Date = new Date()): Promise<RawTextOffloadCycleStatus> {
    // DAR-503: 헤비 수집 창(기본 주말) 밖이면 드레인하지 않고 SKIPPED 로 기록(크론 생존 표면화).
    if (!isHeavyCollectionWindow(now)) {
      this.logger.log(
        'rawText 오프로드 — 헤비 수집 창 밖(주중) 정지, 이번 사이클 WINDOW_SKIPPED(DAR-503)',
      );
      await this.recorder?.recordSkip(CRON_JOB_KEYS.RAWTEXT_OFFLOAD_DRAIN);
      return 'WINDOW_SKIPPED';
    }
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
