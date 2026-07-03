/**
 * BacktestForwardDivergenceController — 백테스트 vs forward 성과 괴리 조회 + 수동 스냅샷 (견고화 W0·P04, DAR-479)
 *
 * GET  /api/paper-trading/simulation/backtest-forward/divergence      — 전략 4종 괴리 조인 리포트(게스트 데모 가능)
 * GET  /api/paper-trading/simulation/backtest-forward/:key/trend      — 한 전략의 일별 괴리 추세(스냅샷 시계열)
 * POST /api/paper-trading/simulation/backtest-forward/snapshot-once   — 당일 괴리 스냅샷 수동 적재(검증·백필 경로)
 *
 * ★ 리플레이 비교(strategies/comparison)·forward 비교(strategies-forward/comparison)와 별개 표면 —
 *   본 API 는 둘을 strategyKey 로 '조인'한 괴리(백테스트 대비 실운용 편차)를 노출한다.
 * ★ 조회·적재 전용 — 실주문 없음. 괴리 산출은 순수 Rule(AI 미개입).
 */

import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { BacktestForwardDivergenceService } from './backtest-forward-divergence.service';
import { formatKstDateCompact } from '../../common/time/kst';

interface SnapshotOnceDto {
  /** YYYYMMDD. 생략 시 오늘(KST) */
  date?: string;
}

@ApiTags('Paper Trading')
@ApiBearerAuth()
@Controller('paper-trading/simulation/backtest-forward')
export class BacktestForwardDivergenceController {
  constructor(private readonly divergence: BacktestForwardDivergenceService) {}

  @Get('divergence')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      '백테스트(리플레이) vs forward(실운용) 성과 괴리 — 전략별 수익률·승률·거래빈도·보유기간 편차(게스트 데모 가능)',
  })
  async divergenceReport() {
    const data = await this.divergence.getDivergenceReport();
    return { success: true, data };
  }

  @Get(':key/trend')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: '한 전략의 일별 괴리 추세(스냅샷 시계열) — 추세 추적용',
  })
  @ApiParam({ name: 'key', description: '전략 키(event-edge 등)' })
  @ApiQuery({ name: 'limit', required: false, description: '최근 N일(기본 90, 최대 365)' })
  async divergenceTrend(@Param('key') key: string, @Query('limit') limit?: string) {
    const parsed = limit != null ? Number(limit) : undefined;
    const data = await this.divergence.getDivergenceTrend(
      key,
      Number.isFinite(parsed) ? (parsed as number) : undefined,
    );
    return { success: true, data };
  }

  @Post('snapshot-once')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: '당일 괴리 스냅샷 수동 적재(멱등 upsert) — 검증·백필 경로',
  })
  async snapshotOnce(@Body() body: SnapshotOnceDto) {
    const tradeDate = body?.date ?? formatKstDateCompact(new Date());
    const data = await this.divergence.snapshotDailyDivergence(tradeDate);
    return { success: true, data };
  }
}
