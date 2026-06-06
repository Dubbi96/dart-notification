// backend/src/engine1-disclosure/disclosure-documents/facts/dart-filed-fact.controller.ts
// DAR-112: 공시 본문 정량 fact 게스트 조회 (read-only, 무가드 — 공시 상세 화면 소비용)
//
// 적재/재처리 등 쓰기 경로는 document-parsing 컨트롤러(JwtAuthGuard)에 그대로 둔다.
// 여기는 모바일 공시 상세가 소비하는 읽기 전용 GET 하나만 공개한다
// (disclosure-events GET과 동일한 게스트 접근 정책).

import { Controller, Get, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { DartFiledFactService } from './dart-filed-fact.service';
import { FiledFactResponseDto } from './dto/filed-fact-response.dto';

@ApiTags('disclosure-facts')
@Controller('disclosure-facts')
export class DartFiledFactController {
  constructor(private readonly dartFiledFactService: DartFiledFactService) {}

  /**
   * GET /disclosure-facts/:rcpNo
   * 단건 공시의 적재된 정량 fact 조회 (factKey 정렬, 게스트 접근).
   * 추출 fact가 없으면 빈 배열 — 화면에서 빈 상태로 분기.
   */
  @Get(':rcpNo')
  @ApiOperation({
    summary: '공시 본문 정량 fact 조회',
    description:
      'DAR-95로 적재된 공시 본문 정량값(계약금액·전환가·배당성향 등)을 rcpNo 단위로 반환. read-only.',
  })
  @ApiParam({ name: 'rcpNo', description: 'DART 접수번호' })
  @ApiResponse({ status: 200, type: [FiledFactResponseDto] })
  async getFacts(
    @Param('rcpNo') rcpNo: string,
  ): Promise<FiledFactResponseDto[]> {
    const facts = await this.dartFiledFactService.findByRcpNo(rcpNo);
    return facts.map((f) => ({
      rcpNo: f.rcpNo,
      corpCode: f.corpCode,
      factKey: f.factKey,
      value: f.value,
      numericValue: f.numericValue,
      unit: f.unit,
      period: f.period,
      sectionPath: f.sectionPath,
      docType: f.docType,
    }));
  }
}
