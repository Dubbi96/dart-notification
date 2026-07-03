// Engine3 — 2단 프레임 백테스트 게이트 컨트롤러 (DAR-493 [견고화 W1·P16])
//
// POST /api/paper-trading/backtest/two-tier-gate
//   — 신규 2트랙(코어 듀얼모멘텀·위성 변동성돌파) 비용 반영 백테스트 → 엣지 게이트 리포트 반환.
//   JWT 필수(무거운 계산). ★read-only — BacktestRun/Trade 영속 0. 상시 크론 아님(수동 트리거).
// ★★게이트 판정은 forward 활성의 선행 조건일 뿐, 활성 결정은 통합자·사용자 소관. AI 자동조정 금지(§8.4).

import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { TwoTierBacktestService, TwoTierGateInput } from './two-tier-backtest.service';

interface TwoTierGateRequestDto {
  /** 조회 시작일 YYYYMMDD(미지정 시 전 구간). */
  startDate?: string;
  /** 조회 종료일 YYYYMMDD(미지정 시 전 구간). */
  endDate?: string;
  /** 트랙별 초기 가상원금(원). 기본 10,000,000. */
  initialCapital?: number;
}

@ApiTags('Paper Trading')
@ApiBearerAuth()
@Controller('paper-trading/backtest')
export class TwoTierBacktestController {
  constructor(private readonly service: TwoTierBacktestService) {}

  @Post('two-tier-gate')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      '2단 프레임 신규 2트랙 백테스트 엣지 게이트(read-only). 비용 반영 후 엣지 양수 여부 리포트. 활성 결정은 사람 소관.',
  })
  async run(@Body() body: TwoTierGateRequestDto) {
    const input: TwoTierGateInput = {
      startDate: body.startDate,
      endDate: body.endDate,
      initialCapital: body.initialCapital,
    };
    const data = await this.service.runGateReport(input);
    return { success: true, data };
  }
}
