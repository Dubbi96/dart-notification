// backend/src/disclosure-documents/parse-retry.scheduler.ts
// 파싱 실패 건 재처리 스케줄러 (매 30분)

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DisclosureDocumentsService } from './disclosure-documents.service';

/** 1회 재처리 최대 건수 */
const MAX_RETRY_BATCH = 20;

@Injectable()
export class ParseRetryScheduler {
  private readonly logger = new Logger(ParseRetryScheduler.name);

  constructor(
    private readonly disclosureDocumentsService: DisclosureDocumentsService,
  ) {}

  /**
   * 매 30분마다 파싱 실패 건 재처리
   * FETCH_FAILED / PARSE_FAILED 상태이고 retryCount < MAX_RETRY(3)인 건 대상
   */
  @Cron('*/30 * * * *')
  async retryFailedDocuments(): Promise<void> {
    this.logger.log('파싱 실패 건 재처리 스케줄러 실행');

    try {
      const result =
        await this.disclosureDocumentsService.runRetryQueue(MAX_RETRY_BATCH);
      this.logger.log(`재처리 큐 실행 완료: ${result.queued}건 시작`);
    } catch (error) {
      // Cron 스케줄 유지를 위해 throw하지 않음
      this.logger.error('재처리 스케줄러 오류', error);
    }
  }
}
