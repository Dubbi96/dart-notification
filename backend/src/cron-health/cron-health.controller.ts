import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataFreshnessService } from './data-freshness.service';
import { FreshnessReportDto } from './dto/freshness.dto';

// 데이터 신선도 모니터 API (read-only, DAR-110) — 수집 안전망.
// 도메인 크론의 마지막 성공시각/건수를 모아 stale(정체) 잡을 표면화한다.
// 신규 수집 로직·외부호출·AI 없음. 기존 로그 테이블 조회만.
@ApiTags('Collection Status')
@Controller('collection')
export class CronHealthController {
  constructor(private readonly freshness: DataFreshnessService) {}

  @Get('freshness')
  @ApiOperation({
    summary: '데이터 신선도/크론 헬스',
    description:
      '공시·시세·재무·신호·모의운용 등 수집 크론의 마지막 성공시각·처리건수를 집계하고 ' +
      'stale(정체) 여부를 판정해 반환한다(read-only). 수집이 조용히 멈춘 상황을 인지하기 위한 안전망.',
  })
  @ApiOkResponse({ type: FreshnessReportDto })
  async getFreshness(): Promise<{ success: boolean; data: FreshnessReportDto }> {
    const data = await this.freshness.getFreshness();
    return { success: true, data };
  }
}
