/**
 * DualMomentumForwardController — 코어 forward 트랙 상태 조회 + 수동 1회 실행 (DAR-494 [견고화 W1·P13])
 *
 * GET  /api/paper-trading/simulation/dual-momentum-forward/status   — 보유·자산곡선·리밸런싱 이력(게스트 데모 가능)
 * POST /api/paper-trading/simulation/dual-momentum-forward/run-once — 1일 사이클 즉시 실행(수동 시작·재현 경로, JWT)
 *
 * ★ 모의 전용 — 실주문 없음. 판정·사이징·체결은 순수 Rule(AI 미개입).
 */

import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../../auth/guards/optional-jwt-auth.guard';
import { DualMomentumForwardService } from './dual-momentum-forward.service';
import { formatKstDateCompact } from '../../../common/time/kst';

interface RunOnceDto {
  /** YYYYMMDD. 생략 시 오늘(KST). */
  date?: string;
}

@ApiTags('Paper Trading')
@ApiBearerAuth()
@Controller('paper-trading/simulation/dual-momentum-forward')
export class DualMomentumForwardController {
  constructor(private readonly service: DualMomentumForwardService) {}

  @Get('status')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      '듀얼모멘텀 코어 forward 상태 — 보유 ETF·자산곡선·월말 리밸런싱 이력(모의, 게스트 데모 가능)',
  })
  async status() {
    const data = await this.service.getStatus();
    return { success: true, data };
  }

  @Post('run-once')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: '코어 forward 1일 사이클 즉시 실행 — 예약 체결→월말 판정·예약→평가(수동 시작·재현)',
  })
  async runOnce(@Body() dto: RunOnceDto) {
    const tradeDate = dto?.date ?? formatKstDateCompact(new Date());
    const data = await this.service.runDailyCycle(tradeDate);
    return { success: true, data };
  }
}
