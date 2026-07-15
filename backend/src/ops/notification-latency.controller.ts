import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import {
  DisclosureLatencyReport,
  NotificationLatencyService,
} from './notification-latency.service';

/**
 * W5 리얼타임성 ③: 공시 알림 지연 계측 엔드포인트 (read-only 집계).
 *
 * GET /ops/notification-latency — 감지(Disclosure.createdAt)→푸시(NotificationHistory.sentAt)
 *   p50/p95 일별 집계. '경쟁사는 주장, 우리는 측정치' 전환의 데이터 소스.
 *
 * ★ read-only — 신규 테이블·수집·외부호출·체결·AI 개입 0. 기존 테이블 집계만.
 * ★인증 미적용 — 비밀값 미노출(지연 통계만). 운영/내부용(/ops/metrics 와 동일 정책).
 */
@ApiTags('Ops')
@Controller('ops')
export class NotificationLatencyController {
  constructor(private readonly latencyService: NotificationLatencyService) {}

  @Get('notification-latency')
  @ApiOperation({
    summary: '공시 알림 감지→푸시 지연 p50/p95 일별 집계(운영/내부용)',
    description:
      '공시(DISCLOSURE) 알림의 감지→푸시 지연을 KST 일별 p50/p95/max 로 집계한다. ' +
      '★지표 정의: DART API 에 접수 시각이 없어(rcept_dt 는 일자뿐) 접수→푸시 E2E 가 아닌 ' +
      "'감지(Disclosure.createdAt)→푸시 발송(NotificationHistory.sentAt)' 구간을 측정한다(정직성 계약). " +
      '기존 테이블 집계만 수행하는 read-only 엔드포인트.',
  })
  @ApiQuery({
    name: 'days',
    required: false,
    description: '집계 윈도(일, 1~30 클램프, 기본 7) — KST 오늘 포함 최근 N일',
    example: 7,
  })
  async getDisclosureLatency(
    @Query('days') days?: string,
  ): Promise<{ success: true; data: DisclosureLatencyReport }> {
    const parsed = days !== undefined ? Number(days) : undefined;
    const data = await this.latencyService.getDisclosureLatencyDaily(
      parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined,
    );
    return { success: true, data };
  }
}
