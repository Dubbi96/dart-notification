// backend/src/disclosure-events/disclosure-events.module.ts

import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { DisclosureEventsService } from './disclosure-events.service';
import { DisclosureEventsController } from './disclosure-events.controller';
import { QUEUE } from '../../common/queues/queue.constants';

@Module({
  imports: [
    BullModule.registerQueue({ name: QUEUE.AI_ANALYZE }),
  ],
  controllers: [DisclosureEventsController],
  providers: [DisclosureEventsService],
  exports: [DisclosureEventsService],
})
export class DisclosureEventsModule {}
