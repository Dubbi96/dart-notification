// backend/src/disclosure-documents/parse-retry.scheduler.ts
// 파싱 실패 건 재처리 스케줄러 (매 30분)

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DisclosureDocumentsService } from './disclosure-documents.service';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';
import { KST_TIMEZONE } from '../../common/time/kst';

/** 1회 재처리 최대 건수 */
const MAX_RETRY_BATCH = 20;

@Injectable()
export class ParseRetryScheduler {
  private readonly logger = new Logger(ParseRetryScheduler.name);

  constructor(
    private readonly disclosureDocumentsService: DisclosureDocumentsService,
    // @Optional: CronHealthModule 미등록 환경(일부 테스트)에서도 동작. 미주입 시 기록만 생략.
    @Optional() private readonly recorder?: CronRunRecorderService,
  ) {}

  /**
   * 매 30분마다 파싱 실패 건 재처리
   * FETCH_FAILED / PARSE_FAILED 상태이고 retryCount < MAX_RETRY(3)인 건 대상
   * (간격형이라 TZ 무관이나 KST 명시로 의도 고정)
   */
  @Cron('*/30 * * * *', { timeZone: KST_TIMEZONE })
  async retryFailedDocuments(): Promise<void> {
    this.logger.log('파싱 실패 건 재처리 스케줄러 실행');

    const run = async () => {
      const result =
        await this.disclosureDocumentsService.runRetryQueue(MAX_RETRY_BATCH);
      this.logger.log(`재처리 큐 실행 완료: ${result.queued}건 시작`);
      return result;
    };

    try {
      if (!this.recorder) {
        await run();
        return;
      }
      // DAR-110: 마지막 성공시각/재처리건수 기록(신선도 판정 입력).
      await this.recorder.record(CRON_JOB_KEYS.PARSE_RETRY, run, {
        countOf: (r) => r.queued,
      });
    } catch (error) {
      // Cron 스케줄 유지를 위해 throw하지 않음 (recorder는 FAILED 기록 후 예외 재던짐 → 여기서 흡수)
      this.logger.error('재처리 스케줄러 오류', error);
    }
  }
}
