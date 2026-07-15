import { LegalController } from './legal.controller';

/**
 * 갭분석 W3 — 법적 고지 페이지 필수 요소 검증.
 * Play 정책 요구 요소(인앱 탈퇴 경로 안내 · 이메일 문의 경로 · 처리방침 상호 링크)가
 * 정적 HTML 에서 누락되면 실패한다.
 */
describe('LegalController', () => {
  const controller = new LegalController();

  describe('GET /legal/privacy', () => {
    const html = controller.getPrivacy();

    it('완결된 한국어 HTML 문서다', () => {
      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('lang="ko"');
      expect(html).toContain('charset="utf-8"');
    });

    it('처리방침 필수 섹션(수집 항목·보유 기간·파기·보호책임자)을 포함한다', () => {
      expect(html).toContain('개인정보 처리방침');
      expect(html).toContain('1. 수집하는 개인정보 항목');
      expect(html).toContain('3. 개인정보의 보유 및 이용 기간');
      expect(html).toContain('7. 개인정보의 파기');
      expect(html).toContain('8. 개인정보 보호책임자');
      expect(html).toContain('support@gongsion.com');
    });

    it('계정 삭제 안내 페이지로 연결된다', () => {
      expect(html).toContain('/api/legal/account-deletion');
    });
  });

  describe('GET /legal/account-deletion', () => {
    const html = controller.getAccountDeletion();

    it('앱 내 탈퇴 경로(설정 → 프로필 → 회원 탈퇴)를 안내한다', () => {
      expect(html).toContain('회원 탈퇴');
      expect(html).toContain('프로필');
    });

    it('이메일 삭제 요청 경로를 안내한다', () => {
      expect(html).toContain('mailto:support@gongsion.com');
    });

    it('삭제되는 데이터 범위를 명시한다', () => {
      expect(html).toContain('즉시 영구 삭제');
      expect(html).toContain('관심기업');
      expect(html).toContain('포트폴리오');
    });
  });
});
