import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../../auth/guards/optional-jwt-auth.guard';
import { StrategyTrackService } from './strategy-track.service';

/**
 * StrategyTrackController — DAR-404 시스템 트레이딩 전략 변형 4종 비교/거래내역.
 *
 * GET  /api/paper-trading/simulation/strategies/comparison          — 전략 4종 비교(누적수익 ranking·게스트 가능)
 * GET  /api/paper-trading/simulation/strategies/:key/trade-history  — 전략별 과거 매수/매도 트랙(게스트 가능)
 * POST /api/paper-trading/simulation/strategies/refresh             — 4 트랙 즉시 갱신(JWT 필수: 쓰기·비용)
 *
 * ★ 트랙은 라이브 모의와 격리된 백테스트 포트폴리오(BacktestRun/Trade·strategyKey). 실주문 없음.
 *   엔진 경계: 컨트롤러/서비스 모두 engine3(backtest) 소속이며 URL 네임스페이스만 paper-trading 을 쓴다
 *   (엔진 간 직접호출 0). AI 금지영역 불가침 — 신호·체결·손절·청산 전부 순수 Rule.
 */
@ApiTags('Paper Trading')
@ApiBearerAuth()
@Controller('paper-trading/simulation/strategies')
export class StrategyTrackController {
  constructor(private readonly tracks: StrategyTrackService) {}

  @Get('comparison')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: '전략 변형 4종 비교(자산곡선·누적수익·승률·Sharpe·MDD + 누적수익 ranking, 게스트 데모 가능)',
  })
  async comparison() {
    const data = await this.tracks.getComparison();
    return { success: true, data };
  }

  @Get(':key/trade-history')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiParam({
    name: 'key',
    description: '전략 키(event-edge | short-momentum | conservative-value | aggressive-diversified)',
  })
  @ApiOperation({ summary: '전략별 과거 매수/매도 트랙(BacktestTrade) 최신순(게스트 데모 가능)' })
  async tradeHistory(@Param('key') key: string) {
    const data = await this.tracks.getTradeHistory(key);
    return { success: true, data };
  }

  @Post('refresh')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '전략 변형 4종 다중 트랙 즉시 갱신(point-in-time 리플레이 재실행)' })
  async refresh() {
    const data = await this.tracks.refreshAll();
    return { success: true, data };
  }
}
