import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { AiCostAggregationService } from '../cost-aggregation/ai-cost-aggregation.service';
import { AiCostLimitGuardService } from '../cost-gate/ai-cost-limit-guard.service';
import { AiUsageLogService } from '../usage-log/ai-usage-log.service';
import { AiCostHealthService } from './ai-cost-health.service';

@ApiTags('AI Cost Governance')
@Controller('ai-cost')
export class AiCostMetricsController {
  constructor(
    private readonly aggregation: AiCostAggregationService,
    private readonly limitGuard: AiCostLimitGuardService,
    private readonly usageLog: AiUsageLogService,
    private readonly health: AiCostHealthService,
  ) {}

  @Get('metrics')
  @ApiOperation({ summary: 'AI 비용 지표 조회 (기간별)' })
  @ApiQuery({ name: 'from', required: false, example: '2026-06-01' })
  @ApiQuery({ name: 'to', required: false, example: '2026-06-30' })
  async getMetrics(@Query('from') from?: string, @Query('to') to?: string) {
    const now = new Date();
    const fromDate = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const toDate = to ? new Date(to) : now;
    const metrics = await this.usageLog.getCostMetrics(fromDate, toDate);
    return { success: true, data: metrics };
  }

  @Get('daily')
  @ApiOperation({ summary: '일별 AI 비용 집계' })
  @ApiQuery({ name: 'date', required: false, example: '2026-06-05' })
  async getDailySummary(@Query('date') date?: string) {
    const target = date ? new Date(date) : new Date();
    const summary = await this.aggregation.getDailySummary(target);
    return { success: true, data: summary };
  }

  @Get('monthly')
  @ApiOperation({ summary: '월별 AI 비용 집계' })
  @ApiQuery({ name: 'year', required: false, example: '2026' })
  @ApiQuery({ name: 'month', required: false, example: '6' })
  async getMonthlySummary(@Query('year') year?: string, @Query('month') month?: string) {
    const now = new Date();
    const y = year ? parseInt(year) : now.getFullYear();
    const m = month ? parseInt(month) : now.getMonth() + 1;
    const summary = await this.aggregation.getMonthlySummary(y, m);
    return { success: true, data: summary };
  }

  @Get('limit-status')
  @ApiOperation({ summary: 'AI 비용 한도 현황 조회' })
  async getLimitStatus() {
    const status = await this.limitGuard.getLimitStatus();
    return { success: true, data: status };
  }

  @Get('health')
  @ApiOperation({
    summary: '라이브 AI 비용게이트 상시 모니터링 헬스 (수용기준·한도 충족 플래그)',
  })
  async getHealth() {
    const data = await this.health.getHealth();
    return { success: true, data };
  }

  @Get('cross-engine')
  @ApiOperation({ summary: 'Cross-engine 비용 지표 (공시/신호/거래당 비용)' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async getCrossEngineMetrics(@Query('from') from?: string, @Query('to') to?: string) {
    const now = new Date();
    const fromDate = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const toDate = to ? new Date(to) : now;
    const metrics = await this.aggregation.getCrossEngineCostMetrics(fromDate, toDate);
    return { success: true, data: metrics };
  }
}
