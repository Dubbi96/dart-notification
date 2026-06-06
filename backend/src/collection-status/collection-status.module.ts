import { Module } from '@nestjs/common';
import { CollectionStatusController } from './collection-status.controller';
import { CollectionStatusService } from './collection-status.service';

// 수집 상태 대시보드 — 엔진 횡단 read-only 집계 모듈(독립 유지).
// PrismaModule 은 전역(@Global)이라 별도 import 불필요.
@Module({
  controllers: [CollectionStatusController],
  providers: [CollectionStatusService],
  exports: [CollectionStatusService],
})
export class CollectionStatusModule {}
