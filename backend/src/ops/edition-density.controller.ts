import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { EditionDensityService } from './edition-density.service';
import { EditionDensityReport } from './edition-density.types';

/**
 * 에디션 밀도 실측 엔드포인트 (DAR-513, Wave A/A3 · read-only 집계).
 *
 * GET /ops/edition-density?days=60 — 최근 N(기본 60) 거래일의 일자별 에디션 신호 건수 분포.
 *   '1거래일=1호' 에디션이 '대부분 빈 신문'인지 판정할 데이터(중앙값·평균·0건일 비율 + 판정).
 *
 * ★ read-only — SELECT/COUNT 만. 신규 테이블·수집·외부호출·체결·AI 개입·마이그레이션 0.
 *   M10 무오염(읽기 API 한정) 준수. prod DB 에 읽기 전용으로 안전 실행 가능.
 * ★인증 미적용 — 비밀값 미노출(신호 건수 통계만). 운영/내부용(/ops/metrics·notification-latency 동일 정책).
 */
@ApiTags('Ops')
@Controller('ops')
export class EditionDensityController {
  constructor(private readonly editionDensityService: EditionDensityService) {}

  @Get('edition-density')
  @ApiOperation({
    summary: '에디션 밀도 실측 — 최근 N거래일 신호 분포 진단(운영/내부용)',
    description:
      "최근 N(기본 60) 거래일의 일자별 '에디션 신호' 건수 분포를 산출한다. " +
      "에디션 신호 = 매수등급(STRONG_BUY+BUY)·백필 제외 TradingSignal, 귀속 거래일 = createdAt 의 KST 날짜 " +
      '(GET /signals/daily-editions 의 밀도와 1:1). 중앙값·평균·p25/p75·0건일 비율·히스토그램 + 판정' +
      '(중앙값<2 또는 0건일>40% → 폴백 스코프 제안서 오너 판정 회부). ' +
      '보조로 전등급 신호 밀도·분모 교차검증(캘린더 vs 일봉) 동봉. 기존 테이블 집계만 수행하는 read-only.',
  })
  @ApiQuery({
    name: 'days',
    required: false,
    description: '집계 거래일 수(1~120 클램프, 기본 60) — 최근 완료된 거래일 기준 역산',
    example: 60,
  })
  async getEditionDensity(
    @Query('days') days?: string,
  ): Promise<{ success: true; data: EditionDensityReport }> {
    const parsed = days !== undefined ? Number(days) : undefined;
    const data = await this.editionDensityService.getEditionDensity(
      parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined,
    );
    return { success: true, data };
  }
}
