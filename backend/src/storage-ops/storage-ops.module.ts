// backend/src/storage-ops/storage-ops.module.ts
// DAR-397: 저장소 계층화 운영 모듈 — 용량 모니터·디스크 회수·로컬 정리·콜드 라이프사이클.
//
// 의존: PrismaModule(@Global)·StorageModule(@Global, ObjectStorageService)·ConfigModule(@Global).
//   별도 import 불요. AuthModule 의 JwtAuthGuard 는 전역 PassportModule 로 동작.

import { Module } from '@nestjs/common';
import { StorageHealthService } from './storage-health.service';
import { StorageMaintenanceService } from './storage-maintenance.service';
import { StorageOpsController } from './storage-ops.controller';

@Module({
  controllers: [StorageOpsController],
  providers: [StorageHealthService, StorageMaintenanceService],
  exports: [StorageHealthService, StorageMaintenanceService],
})
export class StorageOpsModule {}
