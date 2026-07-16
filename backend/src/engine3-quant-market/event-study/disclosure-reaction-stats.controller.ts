import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { DisclosureReactionStatsService } from './disclosure-reaction-stats.service';

/**
 * 유사공시 반응 통계 조회 API (DAR-511 / 플랜 Wave A·A1).
 *
 * 경로는 스펙 정본(`GET /disclosures/:rcpNo/event-stats`)을 그대로 따르되, 로직은
 * EventStudy 도메인(engine3)에 둔다 → engine1 `DisclosuresController` 무변경(회귀 0).
 * NestJS 는 서로 다른 라우트 패턴이면 동일 베이스경로 컨트롤러 공존을 허용한다
 * (`:rcpNo/event-stats` 2세그먼트 vs engine1 `:rcpNo`/`:rcpNo/analysis` — 충돌 없음).
 *
 * 공개 읽기(비인증): 공시 상세(`GET /disclosures/:rcpNo`)가 게스트 노출이고, 반응 통계는
 * 시장 전체 집계(사용자 무관)라 동일 노출 수준을 유지한다. 전역 가드는 ThrottlerGuard 뿐.
 */
@ApiTags('Disclosures')
@Controller('disclosures')
export class DisclosureReactionStatsController {
  constructor(private readonly reactionStatsService: DisclosureReactionStatsService) {}

  @Get(':rcpNo/event-stats')
  @ApiOperation({
    summary: '유사공시 반응 통계 (유형별 D+1/D+5/D+20 평균수익률·승률·표본수 n)',
    description:
      '해당 공시 이벤트 유형의 시장 전체 EventStudy 반응 통계. n<30 유형은 stats=null+reason=INSUFFICIENT_SAMPLE(소표본 허수 방지). 이벤트 미추출 공시는 results=[].',
  })
  @ApiParam({ name: 'rcpNo', description: '공시 접수번호(Disclosure.rcpNo)' })
  async getEventStats(@Param('rcpNo') rcpNo: string) {
    const data = await this.reactionStatsService.getReactionStatsByRcpNo(rcpNo);
    return { success: true, data };
  }
}
