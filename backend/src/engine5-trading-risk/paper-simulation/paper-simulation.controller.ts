/**
 * PaperSimulationController — 모의운용 진척 조회 + 수동 1회 실행 (M10 모의운용, DAR-40)
 *
 * GET  /api/paper-trading/simulation/status   — 누적 졸업지표 + 포트폴리오 현황
 * POST /api/paper-trading/simulation/run-once — 1일치 사이클 즉시 실행(수동 시작 경로)
 *
 * ★ 모의 전용 — 실주문 없음. AI 금지영역 불가침(트리거/조회만).
 */

import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PaperSimulationService } from './paper-simulation.service';

interface RunOnceDto {
  /** YYYYMMDD. 생략 시 오늘 */
  date?: string;
}

@ApiTags('Paper Trading')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('paper-trading/simulation')
export class PaperSimulationController {
  constructor(private readonly sim: PaperSimulationService) {}

  @Get('status')
  @ApiOperation({ summary: '모의운용 누적 졸업지표·포트폴리오 진척 조회' })
  async status() {
    const data = await this.sim.getSimulationStatus();
    return { success: true, data };
  }

  @Post('run-once')
  @ApiOperation({ summary: '모의운용 1일치 사이클 수동 실행(매수→스냅샷→Exit→지표)' })
  async runOnce(@Body() body: RunOnceDto) {
    const tradeDate = body?.date ?? this.todayBasDd();
    const data = await this.sim.runDailyCycle(tradeDate);
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
