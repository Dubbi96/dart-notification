import { Module } from '@nestjs/common';
import { WebSurfaceController } from './web-surface.controller';
import { WebSurfaceService } from './web-surface.service';

/**
 * 웹 표면(W3b) — 공개 랜딩 + 공시 공유 페이지 (횡단 모듈).
 *
 * 조회 전용 표면: DB 캐시(Disclosure·DisclosureAnalysis)만 읽고
 * 외부 API(DART/KIS/LLM) 호출 0. 라우트는 글로벌 prefix에서 제외(main.ts).
 */
@Module({
  controllers: [WebSurfaceController],
  providers: [WebSurfaceService],
})
export class WebSurfaceModule {}
