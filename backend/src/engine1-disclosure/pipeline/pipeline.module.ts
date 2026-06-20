import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE } from '../../common/queues/queue.constants';
import { DisclosureDocumentsModule } from '../disclosure-documents/disclosure-documents.module';
import { DisclosureEventsModule } from '../disclosure-events/disclosure-events.module';
import { PipelineIntegrityService } from './pipeline-integrity.service';
import { PipelineDrainScheduler } from './pipeline-drain.scheduler';
import { EventBackfillDrainService } from './event-backfill-drain.service';
import { EventBackfillScheduler } from './event-backfill.scheduler';
import { RawTextOffloadDrainService } from './rawtext-offload-drain.service';
import { RawTextOffloadScheduler } from './rawtext-offload.scheduler';
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
 *
 * DAR-391: EventBackfillDrainService/Scheduler 추가 — 과거 백필 공시의 이벤트 추출을 rcpDt
 *   시간순으로 점진 백필(신호·백테스트 연중화 게이트). 동일 모듈의 documents/events 서비스를 재사용.
 * DAR-395: RawTextOffloadDrainService/Scheduler 추가 — 과거 rawText 를 객체 스토리지(S3/로컬)로
 *   점진 이전 후 DB 컬럼 비움(경량화). RawTextStoreService 는 StorageModule(@Global)에서 주입.
 */
@Module({
  imports: [
    DisclosureDocumentsModule,
    DisclosureEventsModule,
    BullModule.registerQueue({ name: QUEUE.AI_ANALYZE }),
  ],
  controllers: [PipelineController],
  providers: [
    PipelineIntegrityService,
    PipelineDrainScheduler,
    EventBackfillDrainService,
    EventBackfillScheduler,
    RawTextOffloadDrainService,
    RawTextOffloadScheduler,
  ],
  exports: [
    PipelineIntegrityService,
    EventBackfillDrainService,
    RawTextOffloadDrainService,
  ],
})
export class PipelineModule {}
