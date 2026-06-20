// backend/src/storage-ops/storage-ops.controller.ts
// DAR-397: 저장소 계층화 운영 엔드포인트(용량 모니터·디스크 회수·로컬 정리·콜드 라이프사이클).
//
// ★인증 필수(JwtAuthGuard) — VACUUM(락)·삭제·라이프사이클은 무인증 호출 시 DoS/데이터 위험.
//   health 는 read-only 이나 동일 가드로 운영/내부 전용 유지.

import {
  Controller,
  Get,
  Post,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StorageHealthService } from './storage-health.service';
import { StorageMaintenanceService } from './storage-maintenance.service';
import {
  LifecycleApplyResult,
  LocalCleanupResult,
  StorageHealth,
  VacuumResult,
} from './storage-ops.types';

@ApiTags('Storage')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('storage')
export class StorageOpsController {
  constructor(
    private readonly health: StorageHealthService,
    private readonly maintenance: StorageMaintenanceService,
  ) {}

  @Get('health')
  @ApiOperation({
    summary:
      'DB 크기·테이블별 용량·rawText 오프로드 진행·객체 스토리지 용량·로컬 임계 경고(read-only). 용량 모니터링.',
  })
  async getHealth(): Promise<{ success: true; data: StorageHealth }> {
    const data = await this.health.getHealth();
    return { success: true, data };
  }

  @Post('vacuum')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'VACUUM (FULL) 로 디스크 실회수 + 전후 크기 리포트(★운영자 수동·오프피크 전용·ACCESS EXCLUSIVE 락). 테이블 화이트리스트.',
  })
  @ApiQuery({
    name: 'table',
    required: false,
    example: 'disclosure_documents',
  })
  @ApiQuery({ name: 'full', required: false, type: Boolean, example: true })
  async vacuum(
    @Query('table') table?: string,
    @Query('full') full?: string,
  ): Promise<{ success: true; data: VacuumResult }> {
    const data = await this.maintenance.reclaimDisk(
      table || 'disclosure_documents',
      full !== 'false',
    );
    return { success: true, data };
  }

  @Post('cleanup-local-artifacts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      '로컬 원시 파일(rawFilePath) 삭제+컬럼 비움 1회 배치(멱등). 읽는 코드 없는 산출물 → 로컬 직접 회수.',
  })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 500 })
  async cleanupLocalArtifacts(
    @Query('limit') limit?: string,
  ): Promise<{ success: true; data: LocalCleanupResult }> {
    const data = await this.maintenance.cleanupLocalArtifacts(
      parseOptionalInt(limit),
    );
    return { success: true, data };
  }

  @Post('lifecycle')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'rawText 객체 콜드 라이프사이클(STANDARD_IA@30d→GLACIER@90d) 적용(idempotent). S3만 실적용·로컬 no-op.',
  })
  async lifecycle(): Promise<{ success: true; data: LifecycleApplyResult }> {
    const data = await this.maintenance.applyLifecycle();
    return { success: true, data };
  }
}

/** 쿼리 정수 옵션 파싱 — 미지정/불량은 undefined(서비스 기본값 사용). */
function parseOptionalInt(raw?: string): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : undefined;
}
