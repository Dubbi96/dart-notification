/**
 * 신호 생성 수동 트리거 컨트롤러 — DAR-41
 * POST /signals/generate — 즉시 1회 신호 생성 (멱등).
 */

import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SignalGenerationService } from './signal-generation.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@ApiTags('signals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('signals')
export class SignalGenerationController {
  constructor(private readonly signalGen: SignalGenerationService) {}

  @Post('generate')
  @ApiOperation({
    summary: '매수 신호 수동 생성 (대상: 이벤트+시세 있고 TradingSignal 없는 공시)',
  })
  async generate() {
    const result = await this.signalGen.generateMissingSignals('MANUAL');
    return { success: true, data: result };
  }
}
