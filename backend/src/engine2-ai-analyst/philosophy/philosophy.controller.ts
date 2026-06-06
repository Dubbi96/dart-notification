/**
 * Persona 철학 엔진 P-B — 철학 적합도 조회 API (DAR-53)
 *
 * AI 미개입(순수 Rule 결과 노출). on-demand 계산 — 영속화 없음.
 *  - GET /philosophies                          철학 목록(P-A 시드)
 *  - GET /philosophies/:id/fit?corpCode=         철학 1종 × 종목 적합도
 *  - GET /companies/:corpCode/philosophy-fit     종목 × 거장별 적합도(전체 철학)
 *
 * 인증(DAR-54): 모두 읽기 전용·교육/발견 가치 → OptionalJwtAuthGuard 로 게스트 열람 허용.
 * 토큰이 있으면 검증해 user 를 채우고, 없거나 무효해도 401 없이 통과한다(쓰기 없음).
 */
import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { OptionalJwtAuthGuard } from '../../auth/guards/optional-jwt-auth.guard';
import { PhilosophyRepository } from './ports/philosophy.repository';
import { PhilosophyFitService } from './philosophy-fit.service';

@ApiTags('Philosophy')
@ApiBearerAuth()
@UseGuards(OptionalJwtAuthGuard)
@Controller()
export class PhilosophyController {
  constructor(
    private readonly philosophies: PhilosophyRepository,
    private readonly fit: PhilosophyFitService,
  ) {}

  @Get('philosophies')
  @ApiOperation({
    summary: '투자자 철학 목록(P-A 시드 — 지표·출처 포함)',
    description: '게스트 열람 가능(OptionalJwtAuthGuard). 인증 없이 호출 가능.',
  })
  @ApiQuery({ name: 'styleTag', required: false, description: '스타일 태그 필터(예: VALUE)' })
  async list(@Query('styleTag') styleTag?: string) {
    const data = styleTag
      ? await this.philosophies.findByStyleTag(styleTag)
      : await this.philosophies.findAll();
    return { success: true, data };
  }

  @Get('philosophies/:id/fit')
  @ApiOperation({
    summary: '철학 1종 × 종목 적합도(0~100) + 통과/미달 근거',
    description: '게스트 열람 가능(OptionalJwtAuthGuard). 인증 없이 호출 가능.',
  })
  @ApiQuery({ name: 'corpCode', required: true, description: 'DART 고유번호 8자리' })
  @ApiQuery({ name: 'fsDiv', required: false, description: 'CFS(기본) | OFS' })
  async philosophyFit(
    @Param('id') id: string,
    @Query('corpCode') corpCode?: string,
    @Query('fsDiv') fsDiv?: string,
  ) {
    if (!corpCode) {
      throw new BadRequestException('corpCode 쿼리 파라미터가 필요합니다.');
    }
    const data = await this.fit.getPhilosophyFit(id, corpCode, fsDiv || 'CFS');
    return { success: true, data };
  }

  @Get('companies/:corpCode/philosophy-fit')
  @ApiOperation({
    summary: '종목 × 거장별 적합도(전체 철학, 점수 내림차순)',
    description: '게스트 열람 가능(OptionalJwtAuthGuard). 인증 없이 호출 가능.',
  })
  @ApiQuery({ name: 'fsDiv', required: false, description: 'CFS(기본) | OFS' })
  async companyFit(
    @Param('corpCode') corpCode: string,
    @Query('fsDiv') fsDiv?: string,
  ) {
    const data = await this.fit.getCompanyFit(corpCode, fsDiv || 'CFS');
    return { success: true, data };
  }
}
