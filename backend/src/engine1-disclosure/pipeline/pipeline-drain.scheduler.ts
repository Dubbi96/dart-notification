import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PipelineIntegrityService } from './pipeline-integrity.service';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';
import { KST_TIMEZONE } from '../../common/time/kst';

/** 1회 드레인 단계별 처리 상한. */
const DRAIN_BATCH = 100;

/**
 * 드레인 사이클 결과 상태.
 * - RAN: 이번 사이클이 실제로 드레인을 수행함(성공/실패 무관, 끝까지 진입).
 * - SKIPPED: 이전 드레인이 진행 중이라 겹침 가드가 즉시 차단함(DAR-229).
 */
export type DrainCycleStatus = 'RAN' | 'SKIPPED';

/**
 * PipelineDrainScheduler (DAR-126) — 수집→파싱→이벤트→AI 폐루프를 닫는 cron.
 *
 * ★근본원인: 수집기는 신규 공시를 PENDING 으로 enqueue 만 하고, PENDING 파싱 문서를
 *   실제로 드레인하는 cron이 없었다(ParseRetryScheduler는 FAILED만 대상). 결과적으로
 *   파싱→이벤트→AI 체이닝이 첫 홉에서 멈춰 PENDING 이 적체될 수 있었다.
 *
 * 본 스케줄러는 매 15분 PipelineIntegrityService.drainOnce() 를 호출해
 *   누락 문서 backfill → PENDING 파싱 드레인 → 무이벤트/PENDING 이벤트 드레인을
 *   순서대로 수행한다. 파싱·이벤트 단계는 완료 직후 AI 큐로 자동 체이닝된다.
 *
 * ★멱등: drainOnce 의 모든 단계가 upsert/상태조건 기반(반복 무해).
 * ★throw 금지: cron 스케줄 유지를 위해 예외를 흡수한다(recorder는 FAILED 기록).
 *
 * ★겹침 가드(DAR-229): drainOnce 는 파싱 100 + 이벤트 100 을 순차 처리하므로 적체 시
 *   15분(cron 간격)을 초과할 수 있다. 락이 없으면 다음 cron 이 겹쳐 같은 PENDING 이벤트를
 *   동시에 집어 동일 rcpNo AI 잡을 중복 발행할 수 있다
 *   (processPendingDisclosures → aiQueue.add(EVENT_EXTRACTED) 는 jobId 없이 발행). 타 스케줄러
 *   (SchedulerService.isCollecting / KrxMarketDataScheduler.isDailyCollecting 등)와 동일하게
 *   in-flight 플래그로 사이클을 직렬화하고, 진행 중이면 즉시 SKIPPED 로 빠진다.
 */
@Injectable()
export class PipelineDrainScheduler {
  private readonly logger = new Logger(PipelineDrainScheduler.name);

  /** 겹침 가드 — 드레인 1회가 끝날 때까지 다음 사이클 진입을 막는다(DAR-229). */
  private isDraining = false;

  constructor(
    private readonly pipeline: PipelineIntegrityService,
    // @Optional: CronHealthModule 미등록 환경(일부 테스트)에서도 동작. 미주입 시 기록만 생략.
    @Optional() private readonly recorder?: CronRunRecorderService,
  ) {}

  /** 매 15분 폐루프 드레인. (간격형이라 TZ 무관이나 KST 명시로 의도 고정) */
  @Cron('*/15 * * * *', { timeZone: KST_TIMEZONE })
  async drainPipeline(): Promise<DrainCycleStatus> {
    // 이전 사이클이 아직 진행 중이면 겹치지 않도록 즉시 스킵(중복 AI 잡 발행 방지).
    if (this.isDraining) {
      this.logger.warn('이전 드레인이 진행 중 — 이번 사이클 SKIPPED(겹침 방지)');
      return 'SKIPPED';
    }
    // ★주의: 첫 await 이전에 동기적으로 락을 잡아야 겹친 cron 이 가드를 통과하지 못한다.
    this.isDraining = true;

    this.logger.log('파이프라인 폐루프 드레인 스케줄러 실행');

    const run = () => this.pipeline.drainOnce(DRAIN_BATCH);

    try {
      if (!this.recorder) {
        await run();
        return 'RAN';
      }
      // DAR-110 연계: 마지막 성공시각/처리건수 기록(신선도 판정 입력).
      // itemCount = 이번 사이클에서 전진(파싱 성공 + 이벤트 성공/검토)시킨 총 건수.
      await this.recorder.record(CRON_JOB_KEYS.PIPELINE_DRAIN, run, {
        countOf: (r) =>
          r.parse.success + r.events.success + r.events.needsReview,
      });
      return 'RAN';
    } catch (error) {
      this.logger.error('폐루프 드레인 스케줄러 오류', error);
      return 'RAN';
    } finally {
      // 성공·실패 무관 락 해제 — 다음 cron 이 정상 진입할 수 있어야 한다.
      this.isDraining = false;
    }
  }
}
