// backend/src/engine1-disclosure/upcoming-events/upcoming-events.module.ts
// DAR-538: 공시발 예정 이벤트 캘린더 v1 (읽기 전용 조회 — PrismaModule은 @Global이라 import 불요)

import { Module } from '@nestjs/common';
import { UpcomingEventsService } from './upcoming-events.service';
import { UpcomingEventsController } from './upcoming-events.controller';

@Module({
  controllers: [UpcomingEventsController],
  providers: [UpcomingEventsService],
  exports: [UpcomingEventsService],
})
export class UpcomingEventsModule {}
