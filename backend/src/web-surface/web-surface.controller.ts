import { Controller, Get, Header, HttpStatus, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { WebSurfaceService } from './web-surface.service';

/** 공시 공유 페이지 — 공시는 불변이므로 브라우저·크롤러 캐시를 길게 허용(1일) */
const SHARE_CACHE_CONTROL = 'public, max-age=86400';
/** 랜딩 — 문구 갱신 여지를 두고 1시간 */
const LANDING_CACHE_CONTROL = 'public, max-age=3600';
/** 404 — 미수집 공시가 이후 수집될 수 있으므로 캐시 금지 */
const NOT_FOUND_CACHE_CONTROL = 'no-store';

/**
 * 웹 표면(W3b) — 공개 HTML 라우트(글로벌 prefix `api` 제외 대상, main.ts exclude 참조).
 *
 *  GET /              — 초미니 랜딩(서비스 소개 3줄 + 면책 고지)
 *  GET /share/:rcpNo  — 공시 공유 페이지(og 메타 + 캐시 요약 + 앱 딥링크)
 *
 * 보호: 전역 ThrottlerModule(인메모리) 재사용, 공개 표면이므로 IP당 분당 30회로 하향.
 * 외부 API 호출 0 · DB read-only — DART 쿼터 무접촉.
 */
@ApiTags('Web Surface')
@Throttle({ default: { limit: 30, ttl: 60_000 } })
@Controller()
export class WebSurfaceController {
  constructor(private readonly webSurfaceService: WebSurfaceService) {}

  @Get()
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Header('Cache-Control', LANDING_CACHE_CONTROL)
  @ApiOperation({
    summary: '공개 랜딩 페이지 — 서비스 소개 3줄 + 면책 고지 (인증 불필요, 정적 HTML)',
  })
  @ApiProduces('text/html')
  getLanding(): string {
    return this.webSurfaceService.getLandingHtml();
  }

  @Get('share/:rcpNo')
  @ApiOperation({
    summary:
      '공시 공유 페이지 — og 메타 + 공시 제목·회사명·접수일 + 캐시된 AI 요약(있을 때만) + 앱 딥링크. 미존재 rcpNo는 404 HTML',
  })
  @ApiParam({ name: 'rcpNo', description: 'DART 접수번호(14자리)', example: '20260101000001' })
  @ApiProduces('text/html')
  async getSharePage(
    @Param('rcpNo') rcpNo: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    const page = await this.webSurfaceService.getSharePage(rcpNo);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    if (!page.found) {
      res.status(HttpStatus.NOT_FOUND);
      res.setHeader('Cache-Control', NOT_FOUND_CACHE_CONTROL);
      return page.html;
    }
    res.setHeader('Cache-Control', SHARE_CACHE_CONTROL);
    return page.html;
  }
}
