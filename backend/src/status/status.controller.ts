import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { PublicStatusSnapshot, StatusService } from './status.service';
import { renderStatusHtml } from './status.view';
import { PublicStatusSnapshotDto } from './dto/public-status.dto';

/**
 * [W11/W12] 공개 시스템 무결성 페이지 — 비인증 GET /status (글로벌 prefix 제외, main.ts).
 *
 * - GET /status       : 기본 HTML 1장(브라우저). Accept 가 JSON 만 요구하면 JSON 분기.
 * - GET /status.json  : 항상 JSON.
 *
 * ★비인증 공개 표면 — 운영 사실(수집 건수·파이프라인·크론 성공률·가동 상태)만 노출.
 *   성과·수익률·계정·비밀값 절대 미포함(졸업 전 공개해도 오도 위험 0 원칙).
 * ★60초 인메모리 캐시(StatusService)로 DB 부하 차단 + 전역 throttle(60req/min) 유지.
 */
@ApiTags('Public Status')
@Controller()
export class StatusController {
  constructor(private readonly status: StatusService) {}

  @Get('status')
  @ApiOperation({
    summary: '공개 시스템 상태 페이지(비인증) — HTML 기본, Accept: application/json 시 JSON',
    description:
      '오늘 공시 수집 건수·파싱 파이프라인 상태·최근 24h 크론 성공률·서비스 가동 상태를 ' +
      '운영 사실 그대로 노출한다(성과·수익률 미표시). 60초 인메모리 캐시.',
  })
  @ApiOkResponse({ type: PublicStatusSnapshotDto })
  async getStatusPage(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<PublicStatusSnapshot | string> {
    const snapshot = await this.status.getStatus();
    const accept = req.headers.accept ?? '';
    // JSON 을 명시 요구(HTML 미포함)한 클라이언트만 JSON — 브라우저(text/html)·curl(*/*)은 HTML.
    if (accept.includes('application/json') && !accept.includes('text/html')) {
      return snapshot;
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return renderStatusHtml(snapshot);
  }

  @Get('status.json')
  @ApiOperation({ summary: '공개 시스템 상태 JSON(비인증)' })
  @ApiOkResponse({ type: PublicStatusSnapshotDto })
  async getStatusJson(): Promise<PublicStatusSnapshot> {
    return this.status.getStatus();
  }
}
