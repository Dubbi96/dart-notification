/**
 * IntradayScalpController — 분봉 단타 모의전략 현황 표면화 (DAR-411 / DAR-416)
 *
 * 전용 엔드포인트 — DAR-404 전략 비교(/strategies/comparison)는 백테스트 기반인 반면,
 *   분봉 단타는 forward-only(백테스트 불가)라 별도 트랙으로 노출(표본0/저표본 graceful).
 * 게스트 조회 허용(OptionalJwt) — 모의 트랙은 공개 성과.
 */

import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { OptionalJwtAuthGuard } from '../../../auth/guards/optional-jwt-auth.guard';
import {
  IntradayScalpService,
  ScalpStatus,
  ScalpTradeHistory,
} from './intraday-scalp.service';

@ApiTags('Paper Trading')
@ApiBearerAuth()
@Controller('paper-trading/simulation/intraday-scalp')
export class IntradayScalpController {
  constructor(private readonly scalp: IntradayScalpService) {}

  /** GET /paper-trading/simulation/intraday-scalp/status — forward 누적 성과·보유 현황. */
  @Get('status')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: '분봉 단타 forward 누적 성과·보유 현황·자산곡선(게스트 데모 가능)',
  })
  async getStatus(): Promise<ScalpStatus> {
    return this.scalp.getStatus();
  }

  /**
   * GET /paper-trading/simulation/intraday-scalp/trade-history — 단타 거래 타임라인(최신 진입순).
   *   DAR-416 모바일 표면화 — 종목·진입/청산 시각·사유·수익률을 종목별 1행으로 드릴다운.
   */
  @Get('trade-history')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: '분봉 단타 거래 타임라인(종목·진입/청산 시각·사유·수익률, 최신 진입순, 게스트 데모 가능)',
  })
  async getTradeHistory(): Promise<ScalpTradeHistory> {
    return this.scalp.getTradeHistory();
  }
}
