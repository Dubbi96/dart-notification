// backend/src/engine1-disclosure/pipeline/tables-offload.scheduler.ts
// DAR-399: 과거 tables(파싱 표 JSONB) 객체 스토리지 오프로드 마이그레이션 스케줄러 — DB 경량화를 점진 진행.
//          tables 가 disclosure_documents TOAST 의 진짜 bulk(~1.6GB) — rawText offload(DAR-395)는 부분.

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  TablesOffloadDrainResult,
  TablesOffloadDrainService,
} from './tables-offload-drain.service';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';
import { KST_TIMEZONE } from '../../common/time/kst';

/** 사이클 상태 — RAN(실행) | SKIPPED(겹침 가드 차단). */
export type TablesOffloadCycleStatus = 'RAN' | 'SKIPPED';

/**
 * TablesOffloadScheduler (DAR-399) — 과거 tables 오프로드 마이그레이션 cron.
 *
 * ★카덴스: 매 10분(저트래픽 영향 적음, 1.6GB 를 며칠 내 점진 이전). 배치 상한(200)으로 부하 고정.
 * ★멱등: drainOnce 의 오프로드(동일 키 덮어쓰기)·컬럼 비우기(1회성)가 반복 무해.
 * ★throw 금지: cron 유지를 위해 예외 흡수(recorder 가 FAILED 기록).
 * ★겹침 가드: 드레인 1회가 끝날 때까지 다음 사이클 진입 차단.
 * ★AI 미개입·Engine5 무관(순수 인프라/용량 작업).
 */
@Injectable()
export class TablesOffloadScheduler {
  private readonly logger = new Logger(TablesOffloadScheduler.name);
  private isDraining = false;

  constructor(
    private readonly drainService: TablesOffloadDrainService,
    @Optional() private readonly recorder?: CronRunRecorderService,
  ) {}

  /** 매 10분 과거 tables 오프로드 드레인. */
  @Cron('*/10 * * * *', { timeZone: KST_TIMEZONE })
  async drainOffload(): Promise<TablesOffloadCycleStatus> {
    if (this.isDraining) {
      this.logger.warn(
        '이전 tables 오프로드 드레인이 진행 중 — 이번 사이클 SKIPPED(겹침 방지)',
      );
      return 'SKIPPED';
    }
    // 첫 await 이전 동기 락 획득(겹친 cron 가드).
    this.isDraining = true;

    const run = (): Promise<TablesOffloadDrainResult> =>
      this.drainService.drainOnce();

    try {
      if (!this.recorder) {
        await run();
        return 'RAN';
      }
      await this.recorder.record(CRON_JOB_KEYS.TABLES_OFFLOAD_DRAIN, run, {
        countOf: (r) => r.offloaded,
      });
      return 'RAN';
    } catch (error) {
      this.logger.error('tables 오프로드 드레인 스케줄러 오류', error);
      return 'RAN';
    } finally {
      this.isDraining = false;
    }
  }
}
