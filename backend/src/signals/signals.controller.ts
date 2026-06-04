import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiQuery,
} from '@nestjs/swagger';
import { SignalsService } from './signals.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('signals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('signals')
export class SignalsController {
  constructor(private readonly signalsService: SignalsService) {}

  @Get()
  @ApiOperation({ summary: '매매 신호 목록 조회 (필터·페이지네이션)' })
  @ApiQuery({ name: 'grade', required: false, description: '신호 등급 (STRONG_BUY_CANDIDATE 등)' })
  @ApiQuery({ name: 'personaType', required: false, description: '페르소나 유형' })
  @ApiQuery({ name: 'entryReady', required: false, description: '진입 준비 여부 (true/false)' })
  @ApiQuery({ name: 'page', required: false, description: '페이지 번호 (기본: 1)' })
  @ApiQuery({ name: 'limit', required: false, description: '페이지당 항목 수 (기본: 20)' })
  async findAll(
    @Query('grade') grade?: string,
    @Query('personaType') personaType?: string,
    @Query('entryReady') entryReadyStr?: string,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    const entryReady =
      entryReadyStr === 'true' ? true : entryReadyStr === 'false' ? false : undefined;
    const page = pageStr ? Number(pageStr) : undefined;
    const limit = limitStr ? Number(limitStr) : undefined;

    const result = await this.signalsService.findAll({
      grade,
      personaType,
      entryReady,
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

  @Get(':id')
  @ApiOperation({ summary: '매매 신호 상세 조회' })
  async findOne(@Param('id') id: string) {
    const data = await this.signalsService.findOne(id);
    return { success: true, data };
  }
}
