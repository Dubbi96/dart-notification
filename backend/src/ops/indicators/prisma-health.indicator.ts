import { Injectable } from '@nestjs/common';
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * DB 도달성(readiness) 헬스 인디케이터 (DAR-111).
 * `SELECT 1` 경량 쿼리로 Postgres 연결만 확인 — 데이터 조회·쓰기 없음.
 */
@Injectable()
export class PrismaHealthIndicator extends HealthIndicator {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return this.getStatus(key, true);
    } catch (err) {
      throw new HealthCheckError(
        'DB 도달 실패',
        this.getStatus(key, false, { message: (err as Error).message }),
      );
    }
  }
}
