import { Module } from '@nestjs/common';
import { StatusController } from './status.controller';
import { StatusService } from './status.service';

// [W11/W12] 공개 시스템 무결성(/status) — 횡단 경량 모듈.
// PrismaModule·CronHealthModule(DataFreshnessService) 은 @Global 이라 별도 import 불필요.
@Module({
  controllers: [StatusController],
  providers: [StatusService],
})
export class StatusModule {}
