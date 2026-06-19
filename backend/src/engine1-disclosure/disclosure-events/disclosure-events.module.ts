// backend/src/disclosure-events/disclosure-events.module.ts

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DisclosureEventsService } from './disclosure-events.service';
import { DisclosureEventsController } from './disclosure-events.controller';
import { FailedEventRecoveryScheduler } from './failed-event-recovery.scheduler';
import { QUEUE } from '../../common/queues/queue.constants';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE.AI_ANALYZE }),
  ],
  controllers: [DisclosureEventsController],
  // DAR-347: FailedEventRecoveryScheduler — FAILED 이벤트 주기 재처리·경보(사일런트 손실 방지).
  // PrismaModule(@Global)·CronHealthModule(@Global, CronRunRecorder)은 import 불요.
  providers: [DisclosureEventsService, FailedEventRecoveryScheduler],
  exports: [DisclosureEventsService],
})
export class DisclosureEventsModule {}
