import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OpsMetricsService } from './ops-metrics.service';
import { OpsMetrics } from './ops-metrics.types';

/**
 * 운영 메트릭 엔드포인트 (DAR-111) — 경량 JSON 카운터.
 *
 * GET /ops/metrics — AIUsageLog 누적·최근 신호 수·모의 포지션 수·마지막 수집 시각
 *   (DAR-110 freshness)·졸업지표 G1/G2/G3/G5 현재값·표본수.
 *
 * ★ read-only 집계 — 신규 수집·외부호출·체결·AI 개입 0. prom-client 미사용(JSON).
 * ★인증 미적용 — 비밀값 미노출(카운터·집계만). 운영/내부용 — 프로덕션 노출 범위는
 *   게이트웨이/네트워크에서 제한 권장(/collection/freshness·/graduation/metrics 와 동일 정책).
 */
@ApiTags('Ops')
@Controller('ops')
export class OpsMetricsController {
  constructor(private readonly metricsService: OpsMetricsService) {}

  @Get('metrics')
  @ApiOperation({
    summary:
      '운영 핵심 카운터(JSON) — AI누적·최근신호·모의포지션·마지막수집(freshness)·졸업지표 G1/G2/G3/G5. 운영/내부용',
  })
  async metrics(): Promise<{ success: true; data: OpsMetrics }> {
    const data = await this.metricsService.getMetrics();
    return { success: true, data };
  }
}
