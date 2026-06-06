/**
 * SignalAccuracyController — 신호 사후검증 백테스트 조회 (M9 백테스트, DAR-73)
 *
 * GET /api/backtest/signal-accuracy — 등급·스코어구간·eventType 별 D+5/D+20 실현 초과수익
 *   정밀도(평균·중앙값·승률·표본·유의성) 리포트. DAR-80: 등급 정밀도 매트릭스
 *   (예측등급×실현수익 confusion + 등급 단조성, G1 정량토대)를 `data.gradePrecision` 으로 동봉.
 * GET /api/backtest/calibration — 신호 보정 루프 리포트(DAR-83): 실현 초과수익 vs
 *   EVENT_BASE_SCORES 괴리(gap)·권장 조정량(suggested delta)·lowSample HOLD.
 *   ★ diff 형 권고만 — 상수 자동변경 금지(사람 PR 전용).
 * GET /api/backtest/feature-ab — 피처 A/B 백테스트(DAR-101): 성장률/DartFiledFact/내부자
 *   피처 포함 vs 미포함 두 가중치 구성으로 동일 신호셋 재채점 → 매수등급 D+5/D+20 적중률·
 *   median AR·등급별 정밀도 비교 + 피처별 delta. LOW_SAMPLE → HOLD(과적합 경계).
 *   ★ 증거 리포트만 — 가중치 자동변경 금지(사람 PR 전용).
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

  @Get('calibration')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      '신호 보정 루프: 실현 초과수익 vs EVENT_BASE_SCORES 괴리·권장 delta(diff 형 권고, 자동적용 금지, 게스트 데모 가능)',
  })
  async calibration(
    @Query('limit') limitStr?: string,
    @Query('eventType') eventType?: string,
    @Query('signalGrade') signalGrade?: string,
  ) {
    const limit = limitStr ? parseInt(limitStr, 10) : undefined;
    const data = await this.accuracy.getCalibration({
      limit: Number.isFinite(limit as number) ? limit : undefined,
      eventType: eventType?.trim() || undefined,
      signalGrade: signalGrade?.trim() || undefined,
    });
    return { success: true, data };
  }

  @Get('feature-ab')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      '피처 A/B 백테스트: 성장률/DartFiledFact/내부자 피처 포함 vs 미포함 두 구성으로 동일 신호셋 재채점 → 매수등급 D+5/D+20 적중률·median AR·등급별 정밀도 비교 + 피처별 delta(증거 리포트, 가중치 자동변경 금지, 게스트 데모 가능)',
  })
  async featureAb(
    @Query('limit') limitStr?: string,
    @Query('eventType') eventType?: string,
    @Query('signalGrade') signalGrade?: string,
  ) {
    const limit = limitStr ? parseInt(limitStr, 10) : undefined;
    const data = await this.accuracy.getFeatureAbReport({
      limit: Number.isFinite(limit as number) ? limit : undefined,
      eventType: eventType?.trim() || undefined,
      signalGrade: signalGrade?.trim() || undefined,
    });
    return { success: true, data };
  }
}
