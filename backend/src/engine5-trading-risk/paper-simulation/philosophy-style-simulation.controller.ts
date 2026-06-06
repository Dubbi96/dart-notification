/**
 * PhilosophyStyleSimulationController — 철학 스타일별 모의운용 비교 + 수동 1회 실행 (DAR-76, P-D)
 *
 * GET  /api/paper-trading/simulation/styles/comparison — 스타일별 자산곡선·성적표·졸업지표 비교(게스트 데모 가능)
 * POST /api/paper-trading/simulation/styles/run-once    — 4개 스타일 1일치 사이클 즉시 실행(수동 시작 경로)
 *
 * ★ 모의 전용 — 실주문 없음. 적합도 진입 필터는 순수 Rule(AI 미개입).
 * 가드: comparison 은 OptionalJwt(게스트 데모 — 시스템 모의 포트폴리오라 사용자 분기 없음).
 *   run-once 는 JWT 필수(쓰기 경로). ★run-once 영속화는 DAR-76 마이그레이션 적용 이후 동작.
 */

import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { PhilosophyStyleSimulationService } from './philosophy-style-simulation.service';

interface RunOnceDto {
  /** YYYYMMDD. 생략 시 오늘 */
  date?: string;
}

@ApiTags('Paper Trading')
@ApiBearerAuth()
@Controller('paper-trading/simulation/styles')
export class PhilosophyStyleSimulationController {
  constructor(private readonly styleSim: PhilosophyStyleSimulationService) {}

  @Get('comparison')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      '철학 스타일별 모의운용 성과 비교 — 스타일별 자산곡선·승률·누적수익·졸업지표(게스트 데모 가능)',
  })
  async comparison() {
    const data = await this.styleSim.getStyleComparison();
    return { success: true, data };
  }

  @Post('run-once')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: '철학 스타일별 모의운용 1일치 사이클 수동 실행(스타일×4 분기 운용)',
  })
  async runOnce(@Body() body: RunOnceDto) {
    const tradeDate = body?.date ?? this.todayBasDd();
    const data = await this.styleSim.runDailyCycleAllStyles(tradeDate);
    return { success: true, data };
  }

  private todayBasDd(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }
}
