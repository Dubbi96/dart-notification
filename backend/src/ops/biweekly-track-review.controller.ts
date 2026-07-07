import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BiweeklyTrackReviewService } from './biweekly-track-review.service';
import { BiweeklyTrackReview } from './biweekly-track-review.types';

/**
 * 격주 트랙 성과 순위 리포트 온디맨드 조회 (JWT 필수).
 *
 * GET /ops/track-review — 발송 주기(격주 일요일 10:00 KST)와 무관하게 현재 시점 기준
 *   트레일링 14일 리포트를 즉시 계산해 반환한다(영속 모델 없음 — 온디맨드 계산 전용).
 *
 * ★read-only 집계 — 신규 수집·외부호출·체결·AI 개입 0. 매매/주문/Kill Switch 무접점.
 */
@ApiTags('Ops')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('ops')
export class BiweeklyTrackReviewController {
  constructor(private readonly reviewService: BiweeklyTrackReviewService) {}

  @Get('track-review')
  @ApiOperation({
    summary:
      '격주 트랙 성과 순위 리포트(온디맨드) — 모의투자 전 트랙 트레일링 14일 실현 성과 순위 + 시장국면 태깅. 표본부족(lowSample) 정직 표기',
  })
  async trackReview(): Promise<{ success: true; data: BiweeklyTrackReview }> {
    const data = await this.reviewService.buildReview();
    return { success: true, data };
  }
}
