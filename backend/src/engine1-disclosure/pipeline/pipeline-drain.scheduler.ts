import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PipelineIntegrityService } from './pipeline-integrity.service';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';
import { KST_TIMEZONE } from '../../common/time/kst';

/** 1회 드레인 단계별 처리 상한. */
const DRAIN_BATCH = 100;

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
 */
@Injectable()
export class PipelineDrainScheduler {
  private readonly logger = new Logger(PipelineDrainScheduler.name);

  constructor(
    private readonly pipeline: PipelineIntegrityService,
    // @Optional: CronHealthModule 미등록 환경(일부 테스트)에서도 동작. 미주입 시 기록만 생략.
    @Optional() private readonly recorder?: CronRunRecorderService,
  ) {}

  /** 매 15분 폐루프 드레인. (간격형이라 TZ 무관이나 KST 명시로 의도 고정) */
  @Cron('*/15 * * * *', { timeZone: KST_TIMEZONE })
  async drainPipeline(): Promise<void> {
    this.logger.log('파이프라인 폐루프 드레인 스케줄러 실행');

    const run = () => this.pipeline.drainOnce(DRAIN_BATCH);

    try {
      if (!this.recorder) {
        await run();
        return;
      }
      // DAR-110 연계: 마지막 성공시각/처리건수 기록(신선도 판정 입력).
      // itemCount = 이번 사이클에서 전진(파싱 성공 + 이벤트 성공/검토)시킨 총 건수.
      await this.recorder.record(CRON_JOB_KEYS.PIPELINE_DRAIN, run, {
        countOf: (r) =>
          r.parse.success + r.events.success + r.events.needsReview,
      });
    } catch (error) {
      this.logger.error('폐루프 드레인 스케줄러 오류', error);
    }
  }
}
