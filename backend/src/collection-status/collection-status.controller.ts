import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CollectionStatusService } from './collection-status.service';
import { CollectionStatusDto } from './dto/collection-status.dto';

// 수집 상태 대시보드 집계 API (read-only) — 공시·재무·지표·모의 커버리지를 한 응답으로 노출.
// 신규 수집 로직·외부호출·AI 개입 없음. 기존 테이블 count/max 집계만.
@ApiTags('Collection Status')
@Controller('collection')
export class CollectionStatusController {
  constructor(private readonly collectionStatusService: CollectionStatusService) {}

  @Get('status')
  @ApiOperation({
    summary: '수집 현황 집계',
    description:
      '공시·재무·시세지표·모의운용 파이프라인의 커버리지·최근 수집시각·성숙도 배지를 집계해 반환한다(read-only).',
  })
  @ApiOkResponse({ type: CollectionStatusDto })
  async getStatus(): Promise<{ success: boolean; data: CollectionStatusDto }> {
    const data = await this.collectionStatusService.getStatus();
    return { success: true, data };
  }
}
