/**
 * GraduationController — 졸업 게이트 G1~G5 측정 조회 (M10 졸업 측정, DAR-67)
 *
 * GET /api/graduation/metrics — 졸업지표 현재값 vs 기준 · 통과여부 · 표본수 + LOW_SAMPLE 경고.
 *
 * ★ read-only 집계 — 신규 수집·외부호출·체결·AI 개입 0(GraduationMetricsService + 순수 게이트 평가).
 * 가드: OptionalJwtAuthGuard — 단일 시스템 모의 포트폴리오라 사용자별 분기 없음(게스트 데모 조회 허용,
 *   equity-curve 와 동일 정책).
 */

import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { GraduationMetricsService } from './graduation-metrics.service';
import { buildGraduationReport, GraduationReport } from './domain/graduation-gates';

@ApiTags('Graduation')
@Controller('graduation')
export class GraduationController {
  constructor(private readonly metricsService: GraduationMetricsService) {}

  @Get('metrics')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      '졸업 게이트(G1 적중률·G2 누적수익·G3 AI비용/순익·G5 Exit정확도) 현재값 vs 기준·통과여부·표본수 — 게스트 데모 조회 가능',
  })
  async metrics(): Promise<{ success: true; data: GraduationReport }> {
    const metrics = await this.metricsService.getMetrics();
    return { success: true, data: buildGraduationReport(metrics) };
  }
}
