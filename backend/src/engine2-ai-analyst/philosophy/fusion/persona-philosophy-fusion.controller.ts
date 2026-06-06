/**
 * Persona 철학 엔진 P-C — 거장 철학 × AI 관점 통합 뷰 API (DAR-72)
 *
 * AI 결합점수 미사용(순수 Rule 결과 노출). 신규 AI 호출 0(저장 산출물만 조회).
 *   - GET /companies/:corpCode/persona-philosophy-fusion?fsDiv=
 *
 * 인증(DAR-54 패턴): 읽기 전용·발견 가치 → OptionalJwtAuthGuard 로 게스트 열람 허용.
 */
import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { OptionalJwtAuthGuard } from '../../../auth/guards/optional-jwt-auth.guard';
import { PersonaPhilosophyFusionService } from './persona-philosophy-fusion.service';

@ApiTags('Philosophy')
@ApiBearerAuth()
@UseGuards(OptionalJwtAuthGuard)
@Controller()
export class PersonaPhilosophyFusionController {
  constructor(private readonly fusion: PersonaPhilosophyFusionService) {}

  @Get('companies/:corpCode/persona-philosophy-fusion')
  @ApiOperation({
    summary: '종목 × 거장 철학 × AI 관점 결합(결합점수·근거·표본·신뢰도)',
    description:
      '거장 철학 적합도(Rule)와 저장된 AI persona 관점(레이블)을 신규 AI 호출 없이 ' +
      '순수 Rule 로 결합한다. 게스트 열람 가능(OptionalJwtAuthGuard).',
  })
  @ApiQuery({ name: 'fsDiv', required: false, description: 'CFS(기본) | OFS' })
  async companyFusion(
    @Param('corpCode') corpCode: string,
    @Query('fsDiv') fsDiv?: string,
  ) {
    const data = await this.fusion.getCompanyFusion(corpCode, fsDiv || 'CFS');
    return { success: true, data };
  }
}
