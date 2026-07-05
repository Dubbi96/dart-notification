// backend/src/engine1-disclosure/scheduler/continuous-backfill.scheduler.ts
// DAR-396: 과거 공시 메타데이터 연속 확장 백필 cron — 매시간, 쿼터 인지, 자정 리셋 후 자동 재개.

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  ContinuousBackfillDrainService,
  ContinuousBackfillResult,
} from './continuous-backfill-drain.service';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';
import { KST_TIMEZONE } from '../../common/time/kst';
import { isHeavyCollectionWindow } from '../common/heavy-collection-window';

/**
 * 드레인 사이클 결과 상태.
 * - RAN: 이번 사이클이 실제 드레인을 수행함(끝까지 진입, 성공/예외 무관).
 * - SKIPPED: 이전 드레인이 진행 중이라 겹침 가드가 즉시 차단함.
 * - WINDOW_SKIPPED: DAR-503 헤비 수집 창 밖(주중) — 정책상 정지.
 */
export type ContinuousBackfillCycleStatus = 'RAN' | 'SKIPPED' | 'WINDOW_SKIPPED';

/**
 * ContinuousBackfillScheduler (DAR-396) — 과거 공시 메타데이터 연속 확장 백필 cron.
 *
 * ★카덴스: 매시간 발화하되 실제 백필은 **주말 창**에만 수행한다(DAR-503) — DART 일일쿼터를
 *   대량 소비하던 연속 백필을 라이브 수집(주중 실시간)과 분리한다. 주중 사이클은 즉시
 *   WINDOW_SKIPPED(백필 미수행) + CronRunLog SKIPPED 기록. 주말에는 list/document 공유 쿼터를
 *   배려해 1회 소수 청크만 진행하고, 쿼터가 살아있는 한 매시간 더 과거로 내려간다. 일일 쿼터
 *   (자정 리셋, KST) 소진 시 드레이너가 PARTIAL 로 멈추고 다음 정각 사이클이 재시도한다(throw 없음).
 *   기존 quotaExceeded·라이브 예약분 2000 가드는 주말에도 그대로 유지된다.
 *
 * ★멱등: drainOnce 의 수집(rcpNo dedup)·파싱등록(upsert)이 반복 무해.
 * ★throw 금지: cron 스케줄 유지를 위해 예외를 흡수한다(recorder 가 FAILED 기록).
 * ★겹침 가드: 드레인 1회가 끝날 때까지 다음 사이클 진입을 막는다(중복 DART 호출 방지).
 */
@Injectable()
export class ContinuousBackfillScheduler {
  private readonly logger = new Logger(ContinuousBackfillScheduler.name);

  /** 겹침 가드 — 드레인 1회가 끝날 때까지 다음 사이클 진입을 막는다. */
  private isDraining = false;

  constructor(
    private readonly drainService: ContinuousBackfillDrainService,
    // @Optional: CronHealthModule 미등록 환경(일부 테스트)에서도 동작. 미주입 시 기록만 생략.
    @Optional() private readonly recorder?: CronRunRecorderService,
  ) {}

  /** 매시간 정각 발화 — 주말 창에서만 과거 공시 메타데이터 연속 확장 백필(DAR-503). */
  @Cron('0 * * * *', { timeZone: KST_TIMEZONE })
  async drainBackfill(
    now: Date = new Date(),
  ): Promise<ContinuousBackfillCycleStatus> {
    // DAR-503: 헤비 수집 창(기본 주말) 밖이면 백필하지 않고 SKIPPED 로 기록(DART 쿼터 보호).
    if (!isHeavyCollectionWindow(now)) {
      this.logger.log(
        '연속 백필 — 헤비 수집 창 밖(주중) 정지, 이번 사이클 WINDOW_SKIPPED(DAR-503)',
      );
      await this.recorder?.recordSkip(CRON_JOB_KEYS.DISCLOSURE_BACKFILL_EXTEND);
      return 'WINDOW_SKIPPED';
    }
    // 이전 사이클이 아직 진행 중이면 겹치지 않도록 즉시 스킵(중복 DART 호출 방지).
    if (this.isDraining) {
      this.logger.warn(
        '이전 연속 백필 드레인이 진행 중 — 이번 사이클 SKIPPED(겹침 방지)',
      );
      return 'SKIPPED';
    }
    // ★주의: 첫 await 이전에 동기적으로 락을 잡아야 겹친 cron 이 가드를 통과하지 못한다.
    this.isDraining = true;

    this.logger.log('연속 과거 확장 백필 드레인 스케줄러 실행');

    const run = (): Promise<ContinuousBackfillResult> =>
      this.drainService.drainOnce();

    try {
      if (!this.recorder) {
        await run();
        return 'RAN';
      }
      // DAR-110 연계: 마지막 성공시각/처리건수 기록(신선도 판정 입력).
      // itemCount = 이번 사이클에서 신규 저장한 과거 공시 건수.
      await this.recorder.record(CRON_JOB_KEYS.DISCLOSURE_BACKFILL_EXTEND, run, {
        countOf: (r) => r.savedTotal,
      });
      return 'RAN';
    } catch (error) {
      this.logger.error('연속 백필 드레인 스케줄러 오류', error);
      return 'RAN';
    } finally {
      // 성공·실패 무관 락 해제 — 다음 cron 이 정상 진입할 수 있어야 한다.
      this.isDraining = false;
    }
  }
}
