import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { PriceMoveReasoningQueryService } from './price-move-reasoning-query.service';

/**
 * DAR-526 (Wave C/C2·P0) — '왜 움직였나' 카드 조회 엔드포인트.
 *
 * C1(DAR-522, api-specification §10.8)은 생성(write) 경로를 큐(`price-move-reason`) 전용으로
 * 두고 HTTP 엔드포인트를 노출하지 않았다. 이 컨트롤러는 그와 별개인 조회(read) 표면으로,
 * FE 3상태 카드가 refId(등락 이벤트 자연키)로 적재된 결과 1건을 소비하게 한다.
 * 읽기 전용·마이그레이션 0·AI 무접점(비용게이트/AIUsageLog 무영향).
 */
@ApiTags('PRICE_MOVE 역방향 리즈닝')
@Controller('price-move-reasonings')
export class PriceMoveReasoningController {
  constructor(private readonly query: PriceMoveReasoningQueryService) {}

  @Get(':refId')
  @ApiOperation({
    summary: "'왜 움직였나' 카드 조회 — 등락 이벤트(refId) 리즈닝 1건 (읽기 전용)",
  })
  @ApiParam({
    name: 'refId',
    example: '005930-20260717',
    description: '등락 이벤트 자연키 `<stockCode>-<YYYYMMDD>` (종목당 1일 1회). 미존재 → 404.',
  })
  async getByRefId(@Param('refId') refId: string) {
    const data = await this.query.getByRefId(refId);
    return { success: true, data };
  }
}
