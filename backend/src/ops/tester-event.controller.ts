import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  HttpCode,
  HttpStatus,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { TesterEventService } from './tester-event.service';
import { RecordTesterEventDto } from './dto/record-tester-event.dto';

/**
 * TesterEventController — 테스터 코호트 인앱 행동 계측 (DAR-516, Wave A/A6).
 *
 * POST /ops/tester-event   — 인증 사용자 인앱 이벤트 1건 기록(계측 전용, 202·fire-and-forget).
 * GET  /ops/tester-metrics — 오픈율·재방문 코호트 집계(수용기준 3, ops-facing 조회).
 *
 * FunnelController(비인증 온보딩 퍼널)의 인증판 형제. install/intro/kakao 는 로그인 이전이라
 * anonId 를 쓰지만, 이 이벤트들은 로그인 후 인앱 참여이므로 인증(JwtAuthGuard)+userId 로 적재한다.
 *
 * ★ PII 무수집(수용기준 1): 서버는 userId(인증)·event(화이트리스트)·ts(서버 스탬프)만 저장.
 *   자유텍스트·종목/카드 식별자 입력 경로 없음(event 는 IsIn 화이트리스트뿐).
 * ★ 계측 전용 — 기록 실패도 202 로 응답(모바일 fire-and-forget, 실패 무시).
 * ★ M10 무오염: engine5(매매/리스크) 무접점. 신규 tester_events 읽기·쓰기만.
 */
@ApiTags('Ops')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ops')
export class TesterEventController {
  constructor(private readonly testerEventService: TesterEventService) {}

  @Post('tester-event')
  @HttpCode(HttpStatus.ACCEPTED)
  // 인앱 참여 이벤트는 짧은 시간에 연속 발화(카드 연속 탭 등)하므로 전역 60req/min 위에
  // 라우트 전용 한도(120req/min)를 명시한다 — 단일 사용자 버스트 통과, 이상 적재는 차단.
  @Throttle({ default: { limit: 120, ttl: 60000 } })
  @ApiOperation({
    summary:
      '테스터 코호트 인앱 이벤트 기록(인증 계측) — edition_open/card_tap/push_open/stats_section_view/waitlist_cta/survey_ios_*',
  })
  @ApiResponse({ status: 202, description: '이벤트 수신(적재 실패도 흡수 — 계측 전용)' })
  async record(
    @CurrentUser('id') userId: string,
    @Body() dto: RecordTesterEventDto,
  ): Promise<{ success: boolean }> {
    const recorded = await this.testerEventService.record(userId, dto.event);
    return { success: recorded };
  }

  @Get('tester-metrics')
  @ApiOperation({
    summary: '테스터 코호트 오픈율·재방문 집계(ops-facing) — 관측창 기본 14일, 최대 90일',
  })
  @ApiQuery({ name: 'days', required: false, description: '관측창(일, 1~90, 기본 14)' })
  @ApiResponse({ status: 200, description: '오픈율·재방문 + 이벤트별 카운트' })
  async metrics(
    @Query('days', new DefaultValuePipe(TesterEventService.DEFAULT_WINDOW_DAYS), ParseIntPipe)
    days: number,
  ) {
    const data = await this.testerEventService.cohortMetrics(days);
    return { success: true, data };
  }
}
