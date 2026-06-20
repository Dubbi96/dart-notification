/**
 * 신호 생성 수동 트리거 컨트롤러 — DAR-41
 * POST /signals/generate — 즉시 1회 신호 생성 (멱등).
 */

import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import {
  BackfillSignalOptions,
  SignalGenerationService,
} from './signal-generation.service';
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

  @Post('regenerate')
  @ApiOperation({
    summary:
      '매수 신호 재생성·재채점 (기존 신호 upsert 갱신 — TI 백필 후 chart/entryReady 반영, DAR-50)',
  })
  async regenerate() {
    const result = await this.signalGen.regenerateSignals('MANUAL');
    return { success: true, data: result };
  }

  @Post('generate-backfill')
  @ApiOperation({
    summary:
      '과거(백필) 공시 point-in-time 신호 백필 (분석·백테스트용 — 가격≤rcpDt as-of, 멱등, AI 미개입, DAR-389)',
  })
  async generateBackfill(@Body() options: BackfillSignalOptions = {}) {
    const result = await this.signalGen.generateBackfillSignals(options ?? {});
    return { success: true, data: result };
  }
}
