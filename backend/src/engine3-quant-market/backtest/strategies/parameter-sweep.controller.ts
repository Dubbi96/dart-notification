import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { ParameterSweepService, ParameterSweepInput } from './parameter-sweep.service';

interface SensitivitySweepRequestDto {
  /** YYYY-MM-DD (예: 2025-06-19) */
  startDate: string;
  /** YYYY-MM-DD (예: 2026-06-20) */
  endDate: string;
}

/**
 * ParameterSweepController — DAR-485 전략 파라미터 민감도 스윕(견고화 W3·P24).
 *
 * POST /api/paper-trading/simulation/strategies/:key/sensitivity-sweep
 *   — 프리셋 파라미터 이웃값 그리드(손절 ±2%p·익절 ±5%p·보유일 ±5일·minBuyScore ±5)를 러너 재사용
 *     point-in-time 리플레이로 실행 → 이웃 대비 성과 안정성 리포트 반환. JWT 필수(무거운 계산).
 *
 * ★ read-only 측정 도구 — 수동 트리거 전용(상시 크론 없음). BacktestRun/Trade 영속 0(운용·측정 트랙
 *   무접촉). 리포트는 응답으로만 반환하는 휘발 산출물이다.
 * ★★ AI 자동 파라미터 조정 금지 — 하니스는 측정·리포트만. 파라미터 반영은 룰북 §8 변경 절차
 *   (문서 개정 → 재검증 → 사람 승인)로만.
 */
@ApiTags('Paper Trading')
@ApiBearerAuth()
@Controller('paper-trading/simulation/strategies')
export class ParameterSweepController {
  constructor(private readonly sweep: ParameterSweepService) {}

  @Post(':key/sensitivity-sweep')
  @UseGuards(JwtAuthGuard)
  @ApiParam({
    name: 'key',
    description: '전략 키(event-edge | short-momentum | conservative-value | aggressive-diversified)',
  })
  @ApiOperation({
    summary:
      '전략 파라미터 민감도 스윕(read-only) — 프리셋 이웃값 그리드 성과 안정성 리포트. AI 자동조정 없음(룰북 §8로만 반영).',
  })
  async run(@Param('key') key: string, @Body() body: SensitivitySweepRequestDto) {
    const input: ParameterSweepInput = {
      presetKey: key,
      startDate: body.startDate,
      endDate: body.endDate,
    };
    const data = await this.sweep.run(input);
    return { success: true, data };
  }
}
