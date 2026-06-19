import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../../auth/guards/optional-jwt-auth.guard';
import { BacktestReplayService, ReplayInput } from './backtest-replay.service';

interface ReplayRequestDto {
  /** YYYY-MM-DD (예: 2025-06-19) */
  startDate: string;
  /** YYYY-MM-DD (예: 2026-06-20) */
  endDate: string;
  name?: string;
}

/**
 * BacktestReplayController — DAR-385 1년 자동매매 point-in-time 리플레이.
 *
 * POST /api/backtest/replay              — 리플레이 실행 + 트랙레코드 저장(JWT 필수: 쓰기)
 * GET  /api/backtest/track-record         — 최신 완료 트랙레코드(게스트 데모 가능)
 * GET  /api/backtest/track-record/:id     — id 별 트랙레코드(게스트 데모 가능)
 *
 * ★ 트랙레코드는 라이브 모의와 격리된 별도 백테스트 포트폴리오(BacktestRun/Trade). 실주문 없음.
 *   AI 금지영역 불가침 — 신호·체결·손절·청산 전부 순수 Rule.
 */
@ApiTags('Backtest')
@ApiBearerAuth()
@Controller('backtest')
export class BacktestReplayController {
  constructor(private readonly replay: BacktestReplayService) {}

  @Post('replay')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: '1년 자동매매 point-in-time 리플레이 실행 + 트랙레코드 저장(미래모름 백테스트)',
  })
  async run(@Body() body: ReplayRequestDto) {
    const input: ReplayInput = {
      startDate: body.startDate,
      endDate: body.endDate,
      name: body.name,
    };
    const data = await this.replay.run(input);
    return { success: true, data };
  }

  @Get('track-record')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: '최신 1년 백테스트 트랙레코드 조회(게스트 데모 가능)' })
  async latest() {
    const data = await this.replay.getLatest();
    return { success: true, data };
  }

  @Get('track-record/:id')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'id 별 1년 백테스트 트랙레코드 조회(게스트 데모 가능)' })
  async byId(@Param('id') id: string) {
    const data = await this.replay.getById(id);
    return { success: true, data };
  }
}
