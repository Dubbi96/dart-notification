/**
 * PersonaTradingController — persona별 모의운용 성과 + 현재 장 적합 persona 추천 (DAR-130, P-D)
 *
 * GET  /api/paper-trading/personas         — persona별 성과 + 현재 장 추천(게스트 데모 가능)
 * GET  /api/paper-trading/personas/regime  — 현재 시장 레짐만(추세·변동성·이벤트분포)
 * POST /api/paper-trading/personas/run-once — persona 4종 1일치 사이클 즉시 실행(수동 시작 경로)
 *
 * ★ 모의 전용 — 실주문 없음. 추천 점수/판단은 순수 Rule(AI 금지영역 불가침).
 * 가드: 조회는 OptionalJwt(게스트 데모 — 시스템 모의 포트폴리오라 사용자 분기 없음).
 *   run-once 는 JWT 필수(쓰기 경로).
 */

import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../auth/guards/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '../../../auth/guards/optional-jwt-auth.guard';
import { PersonaTradingService } from './persona-trading.service';

interface RunOnceDto {
  /** YYYYMMDD. 생략 시 오늘 */
  date?: string;
}

@ApiTags('Paper Trading')
@ApiBearerAuth()
@Controller('paper-trading/personas')
export class PersonaTradingController {
  constructor(private readonly personaTrading: PersonaTradingService) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      'persona별 모의운용 성과 + 현재 장 적합 persona 추천 — 자산곡선·성적표·레짐 적합도·추천 근거(게스트 데모 가능)',
  })
  async overview() {
    const data = await this.personaTrading.getOverview();
    return { success: true, data };
  }

  @Get('regime')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: '현재 시장 레짐 — 추세·변동성·이벤트분포(결정론적 분류, 게스트 데모 가능)',
  })
  async regime() {
    const data = await this.personaTrading.getRegime();
    return { success: true, data };
  }

  @Post('run-once')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'persona 4종 모의운용 1일치 사이클 수동 실행(persona별 독립 포트폴리오 분기 운용)',
  })
  async runOnce(@Body() body: RunOnceDto) {
    const tradeDate = body?.date ?? this.todayBasDd();
    const data = await this.personaTrading.runDailyCycle(tradeDate);
    return { success: true, data };
  }

  private todayBasDd(): string {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}${m}${day}`;
  }
}
