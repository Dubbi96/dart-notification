import { Module } from '@nestjs/common';
import { LegalController } from './legal.controller';

/**
 * 갭분석 W3 — 법적 고지 공개 페이지 모듈 (횡단).
 * 개인정보 처리방침·계정 삭제 안내를 비인증 정적 HTML 로 서빙한다.
 */
@Module({
  controllers: [LegalController],
})
export class LegalModule {}
