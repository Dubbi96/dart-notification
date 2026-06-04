// backend/src/disclosure-events/disclosure-events.module.ts

import { Module } from '@nestjs/common';
import { DisclosureEventsService } from './disclosure-events.service';
import { DisclosureEventsController } from './disclosure-events.controller';

@Module({
  controllers: [DisclosureEventsController],
  providers: [DisclosureEventsService],
  exports: [DisclosureEventsService],
})
export class DisclosureEventsModule {}
