import { Controller, Get, Header } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { PRIVACY_HTML, ACCOUNT_DELETION_HTML } from './legal-content';

/**
 * 갭분석 W3 — Play 컴플라이언스 공개 법적 고지 페이지 (횡단, 비인증).
 *
 * Play Console 스토어 리스팅에 게시할 공개 웹 URL:
 * - GET /api/legal/privacy           개인정보 처리방침 (인앱 privacy.tsx 본문 재게시)
 * - GET /api/legal/account-deletion  계정 삭제 방법 안내 (Play 하드 요구사항)
 *
 * API 가 아닌 정적 HTML 문서 표면이므로 Swagger 문서에서 제외한다.
 */
@ApiExcludeController()
@Controller('legal')
export class LegalController {
  @Get('privacy')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getPrivacy(): string {
    return PRIVACY_HTML;
  }

  @Get('account-deletion')
  @Header('Content-Type', 'text/html; charset=utf-8')
  getAccountDeletion(): string {
    return ACCOUNT_DELETION_HTML;
  }
}
