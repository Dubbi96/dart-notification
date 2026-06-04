import { Module } from '@nestjs/common';
import { EventStudyService } from './event-study.service';
import { EventStudyQueryService } from './event-study-query.service';
import { EventStudyController } from './event-study.controller';

@Module({
  controllers: [EventStudyController],
  providers: [EventStudyService, EventStudyQueryService],
  exports: [EventStudyService, EventStudyQueryService],
})
export class EventStudyModule {}
