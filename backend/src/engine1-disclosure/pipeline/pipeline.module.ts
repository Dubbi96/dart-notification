import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE } from '../../common/queues/queue.constants';
import { DisclosureDocumentsModule } from '../disclosure-documents/disclosure-documents.module';
import { DisclosureEventsModule } from '../disclosure-events/disclosure-events.module';
import { PipelineIntegrityService } from './pipeline-integrity.service';
import { PipelineDrainScheduler } from './pipeline-drain.scheduler';
import { PipelineController } from './pipeline.controller';

/**
 * PipelineModule (DAR-126) — 수집→파싱→이벤트→AI 폐루프 견고화.
 *
 * 배선:
 *  - DisclosureDocumentsModule: processPendingBatch/enqueueParsing(파싱 드레인·backfill).
 *  - DisclosureEventsModule: processPendingDisclosures(이벤트 드레인).
 *  - BullModule.registerQueue(AI_ANALYZE): AI summary 수동 재발행용(@Optional 주입).
 *  - PrismaModule(@Global)·CronHealthModule(@Global, CronRunRecorder)는 import 불요.
 *
 * exports: PipelineIntegrityService — OpsMetricsService(/ops/metrics)가 단계 카운트를 재사용.
 */
@Module({
  imports: [
    DisclosureDocumentsModule,
    DisclosureEventsModule,
    BullModule.registerQueue({ name: QUEUE.AI_ANALYZE }),
  ],
  controllers: [PipelineController],
  providers: [PipelineIntegrityService, PipelineDrainScheduler],
  exports: [PipelineIntegrityService],
})
export class PipelineModule {}
