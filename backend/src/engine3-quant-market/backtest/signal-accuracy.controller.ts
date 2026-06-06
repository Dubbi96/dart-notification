/**
 * SignalAccuracyController — 신호 사후검증 백테스트 조회 (M9 백테스트, DAR-73)
 *
 * GET /api/backtest/signal-accuracy — 등급·스코어구간·eventType 별 D+5/D+20 실현 초과수익
 *   정밀도(평균·중앙값·승률·표본·유의성) 리포트.
 *
 * ★ read-only 집계 — 실주문·신규수집·AI 개입 없음. 가중치/임계값을 변경하지 않는다.
 *   게스트 데모 조회 허용(단일 시스템 신호 풀이라 사용자별 분기 없음) → OptionalJwt.
 */
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { SignalAccuracyService } from './signal-accuracy.service';

@ApiTags('Backtest')
@ApiBearerAuth()
@Controller('backtest')
export class SignalAccuracyController {
  constructor(private readonly accuracy: SignalAccuracyService) {}

  @Get('signal-accuracy')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      '신호 사후검증: 등급·스코어구간·eventType 별 D+5/D+20 실현 초과수익 정밀도(게스트 데모 가능)',
  })
  async signalAccuracy(
    @Query('limit') limitStr?: string,
    @Query('eventType') eventType?: string,
    @Query('signalGrade') signalGrade?: string,
  ) {
    const limit = limitStr ? parseInt(limitStr, 10) : undefined;
    const data = await this.accuracy.getSignalAccuracy({
      limit: Number.isFinite(limit as number) ? limit : undefined,
      eventType: eventType?.trim() || undefined,
      signalGrade: signalGrade?.trim() || undefined,
    });
    return { success: true, data };
  }
}
