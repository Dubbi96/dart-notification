import { Module } from '@nestjs/common';
import { EventStudyService } from './event-study.service';

@Module({
  providers: [EventStudyService],
  exports: [EventStudyService],
})
export class EventStudyModule {}
