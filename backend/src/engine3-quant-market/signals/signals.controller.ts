import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { SignalsService, SignalSort } from './signals.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';

@ApiTags('signals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('signals')
export class SignalsController {
  constructor(private readonly signalsService: SignalsService) {}

  @Get()
  @ApiOperation({ summary: '매매 신호 목록 조회 (필터·페이지네이션)' })
  @ApiQuery({ name: 'grade', required: false, description: '신호 등급 (STRONG_BUY|BUY|WATCH|NEUTRAL|AVOID|BLOCKED). 콤마로 다중 지정 가능: "STRONG_BUY,BUY"' })
  @ApiQuery({ name: 'personaType', required: false, description: '페르소나 유형 (GROWTH|VALUE|MOMENTUM|EVENT_DRIVEN)' })
  @ApiQuery({ name: 'eventType', required: false, description: '공시 이벤트 유형 (SUPPLY_CONTRACT 등)' })
  @ApiQuery({ name: 'entryReady', required: false, description: '진입 준비 여부 (true/false)' })
  @ApiQuery({ name: 'sort', required: false, description: '정렬 (score: 점수 내림차순 | latest: 최신순, 기본 latest)' })
  @ApiQuery({ name: 'page', required: false, description: '페이지 번호 (기본: 1)' })
  @ApiQuery({ name: 'limit', required: false, description: '페이지당 항목 수 (기본: 20)' })
  async findAll(
    @Query('grade') grade?: string,
    @Query('personaType') personaType?: string,
    @Query('eventType') eventType?: string,
    @Query('entryReady') entryReadyStr?: string,
    @Query('sort') sortStr?: string,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    const entryReady =
      entryReadyStr === 'true' ? true : entryReadyStr === 'false' ? false : undefined;
    const sort: SignalSort = sortStr === 'score' ? 'score' : 'latest';
    const page = pageStr ? Number(pageStr) : undefined;
    const limit = limitStr ? Number(limitStr) : undefined;

    const result = await this.signalsService.findAll({
      grade,
      personaType,
      eventType,
      entryReady,
      sort,
      page,
      limit,
    });

    return { success: true, data: result.items, meta: result.meta };
  }

  @Get('exit')
  @ApiOperation({ summary: '청산 신호 목록 조회' })
  async findExitSignals() {
    const data = await this.signalsService.findExitSignals();
    return { success: true, data };
  }

  // DAR-159: 종목별 최신 신호 단건 — ':id'(catch-all)보다 먼저 선언해 라우트 충돌 방지.
  @Get('by-corp/:corpCode')
  @ApiOperation({
    summary: '종목별 최신 매수 신호 단건 조회 (corpCode, 백필 제외)',
  })
  async findLatestByCorpCode(@Param('corpCode') corpCode: string) {
    const data = await this.signalsService.findLatestByCorpCode(corpCode);
    return { success: true, data };
  }

  @Get(':id')
  @ApiOperation({ summary: '매매 신호 상세 조회' })
  async findOne(@Param('id') id: string) {
    const data = await this.signalsService.findOne(id);
    return { success: true, data };
  }
}
