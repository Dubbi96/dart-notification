/**
 * StrategyForwardSimulationController — 전략 변형 4종 forward 모의운용 비교 + 수동 1회 실행 (live-readiness W1)
 *
 * GET  /api/paper-trading/simulation/strategies-forward/comparison — 전략별 forward 자산곡선·성적표 비교(게스트 데모 가능)
 * POST /api/paper-trading/simulation/strategies-forward/run-once    — 4개 전략 1일치 사이클 즉시 실행(수동 시작 경로)
 *
 * ★ 리플레이 비교(GET /paper-trading/simulation/strategies/comparison, engine3 §18)와 별개 표면 —
 *   리플레이=과거 1년 재생, 본 API=forward 실운용 누적. 스타일 비교(styles/comparison) 패턴 계승.
 * ★ 모의 전용 — 실주문 없음. 진입 필터·사이징·청산은 순수 Rule(AI 미개입).
 */

import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { StrategyForwardSimulationService } from './strategy-forward-simulation.service';
import { formatKstDateCompact } from '../../common/time/kst';

interface RunOnceDto {
  /** YYYYMMDD. 생략 시 오늘(KST) */
  date?: string;
}

@ApiTags('Paper Trading')
@ApiBearerAuth()
@Controller('paper-trading/simulation/strategies-forward')
export class StrategyForwardSimulationController {
  constructor(private readonly strategySim: StrategyForwardSimulationService) {}

  @Get('comparison')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      '전략 변형 4종 forward 모의운용 성과 비교 — 전략별 자산곡선·승률·누적수익(게스트 데모 가능, 리플레이 비교와 별개)',
  })
  async comparison() {
    const data = await this.strategySim.getStrategyForwardComparison();
    return { success: true, data };
  }

  @Post('run-once')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: '전략 변형 4종 forward 모의운용 1일치 사이클 수동 실행(전략×4 분기 운용)',
  })
  async runOnce(@Body() body: RunOnceDto) {
    const tradeDate = body?.date ?? formatKstDateCompact(new Date());
    const data = await this.strategySim.runDailyCycleAllStrategies(tradeDate);
    return { success: true, data };
  }
}
