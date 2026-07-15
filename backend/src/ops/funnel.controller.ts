import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { FunnelService } from './funnel.service';
import { RecordFunnelEventDto } from './dto/record-funnel-event.dto';

/**
 * FunnelController — POST /ops/funnel (갭분석 W15 ③ 온보딩 퍼널 계측).
 *
 * ★ 비인증 엔드포인트: install/intro/kakao 단계는 로그인 이전이라 인증을 요구할 수 없다.
 *   수용 입력은 anonId+step(+meta 캡) 화이트리스트뿐 — 개인정보·비밀값 미취급.
 * ★ rate limit 완화 가드: 온보딩 5단계가 짧은 시간에 연속 발화하므로 전역
 *   ThrottlerGuard(60req/min) 아래에서 이 라우트 전용 한도(30req/min)를 명시한다 —
 *   단일 기기 온보딩 버스트는 통과, 익명 스팸 적재는 IP 단위로 차단.
 * ★ 계측 전용 — 기록 실패도 202 로 응답(모바일은 fire-and-forget, 실패 무시).
 */
@ApiTags('Ops')
@Controller('ops')
export class FunnelController {
  constructor(private readonly funnelService: FunnelService) {}

  @Post('funnel')
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({
    summary:
      '온보딩 퍼널 이벤트 기록(비인증 계측) — install/intro/kakao/watchlist/push_permission 5단계',
  })
  @ApiResponse({ status: 202, description: '이벤트 수신(적재 실패도 흡수 — 계측 전용)' })
  async record(@Body() dto: RecordFunnelEventDto): Promise<{ success: boolean }> {
    const recorded = await this.funnelService.record(dto);
    return { success: recorded };
  }
}
