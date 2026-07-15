import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BriefingService } from './briefing.service';

/**
 * BriefingController (W14) — 오늘의 브리핑 읽기 API.
 * 전 섹션 0건이면 data=null(모바일 0건 억제 패턴과 계약 일치).
 */
@ApiTags('Portfolio')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('portfolio/briefing')
export class BriefingController {
  constructor(private readonly briefingService: BriefingService) {}

  @Get('today')
  @ApiOperation({
    summary:
      "오늘의 브리핑 조회 — 포지션·관심종목 당일 공시 이벤트(캐시 요약 1줄)·일간 손익·점검 필요 포지션·리스크 스냅샷 (LLM $0 룰 기반, 전 섹션 0건이면 null)",
  })
  async findToday(@CurrentUser('id') userId: string) {
    const data = await this.briefingService.buildTodayBriefing(userId);
    return { success: true, data };
  }
}
