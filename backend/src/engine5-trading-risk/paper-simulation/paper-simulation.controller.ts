/**
 * PaperSimulationController — 모의운용 진척 조회 + 수동 1회 실행 (M10 모의운용, DAR-40)
 *
 * GET  /api/paper-trading/simulation/status        — 누적 졸업지표 + 포트폴리오 현황
 * GET  /api/paper-trading/simulation/equity-curve   — 일별 자산곡선 + 졸업 진척(게스트 데모 가능)
 * POST /api/paper-trading/simulation/run-once        — 1일치 사이클 즉시 실행(수동 시작 경로)
 *
 * ★ 모의 전용 — 실주문 없음. AI 금지영역 불가침(트리거/조회만).
 * 가드: status·run-once 는 JWT 필수. equity-curve 는 OptionalJwt(게스트 데모 허용 — 단일
 *   시스템 모의 포트폴리오라 사용자별 분기 없음). 클래스 일괄 가드 대신 메서드별 부여.
 */

import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { PaperSimulationService } from './paper-simulation.service';

interface RunOnceDto {
  /** YYYYMMDD. 생략 시 오늘 */
  date?: string;
}

@ApiTags('Paper Trading')
@ApiBearerAuth()
@Controller('paper-trading/simulation')
export class PaperSimulationController {
  constructor(private readonly sim: PaperSimulationService) {}

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '모의운용 누적 졸업지표·포트폴리오 진척 조회' })
  async status() {
    const data = await this.sim.getSimulationStatus();
    return { success: true, data };
  }

  @Get('equity-curve')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: '모의 자산곡선(일별 평가금액 시계열) + 졸업 진척 — 게스트 데모 조회 가능',
  })
  async equityCurve() {
    const data = await this.sim.getEquityCurve();
    return { success: true, data };
  }

  @Get('trade-history')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      '모의 매매 사유 추적 + 성적표 — 진입/청산 근거 + 승률·평균손익·누적수익률(게스트 데모 가능)',
  })
  async tradeHistory() {
    const data = await this.sim.getTradeHistory();
    return { success: true, data };
  }

  @Post('run-once')
  @UseGuards(JwtAuthGuard)
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
