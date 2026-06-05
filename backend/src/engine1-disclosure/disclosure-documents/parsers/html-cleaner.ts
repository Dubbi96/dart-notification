// backend/src/disclosure-documents/parsers/html-cleaner.ts
// 의존성: 정규식만 사용 (cheerio 없음)

/**
 * HTML 문자열에서 순수 텍스트를 추출한다.
 *
 * 제거 규칙 (순서 중요):
 *   R-01: DOCTYPE / SGML 선언 제거
 *   R-02: HTML 주석 제거
 *   R-03: <script> 블록 제거
 *   R-04: <style> 블록 제거
 *   R-05: XML 처리 명령 제거 (<?...?>)
 *   R-06: 모든 HTML/XML 태그 제거 → 공백 1개로 대체
 *   R-07: HTML 엔터티 정규화 (&amp; 우선)
 *   R-08: 공백·개행 정규화
 *
 * @returns 정규화된 순수 텍스트
 *          (200,000자 상한 truncate는 서비스 레이어에서 수행)
 */
export function cleanHtml(html: string): string {
  let text = html;

  // R-01: DOCTYPE / SGML 선언 제거
  text = text.replace(/<!DOCTYPE[^>]*>/gi, '');
  text = text.replace(/<!SGML[^>]*>/gi, '');

  // R-02: HTML 주석 제거 (non-greedy)
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // R-03: <script> 블록 제거
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');

  // R-04: <style> 블록 제거
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');

  // R-04b: <nav>/<header>/<footer> 블록 내용 제거 (rawText 오염 방지)
  text = text.replace(/<(nav|header|footer)\b[\s\S]*?<\/\1>/gi, '');

  // R-05: XML 처리 명령 제거 (<?xml ... ?> 등)
  text = text.replace(/<\?[\s\S]*?\?>/g, '');

  // R-06: 모든 HTML/XML 태그 제거 → 공백 1개로 대체 (단어 붙음 방지)
  text = text.replace(/<[^>]+>/g, ' ');

  // R-07: HTML 엔터티 정규화 — &amp; 반드시 가장 먼저
  text = text.replace(/&amp;/gi, '&');
  text = text.replace(/&lt;/gi, '<');
  text = text.replace(/&gt;/gi, '>');
  text = text.replace(/&quot;/gi, '"');
  text = text.replace(/&apos;/gi, "'");
  text = text.replace(/&nbsp;/gi, ' ');
  text = text.replace(/&#xA0;/gi, ' ');
  text = text.replace(/&#160;/gi, ' ');
  // 십진수 NCR
  text = text.replace(/&#([0-9]+);/g, (_, code) =>
    String.fromCharCode(parseInt(code, 10)),
  );
  // 16진수 NCR
  text = text.replace(/&#x([0-9a-fA-F]+);/g, (_, code) =>
    String.fromCharCode(parseInt(code, 16)),
  );

  // R-08: 공백 정규화
  // 1) \r\n / \r → \n
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  // 2) 탭 → 공백 1개
  text = text.replace(/\t/g, ' ');
  // 3) 연속 공백(2개 이상) → 공백 1개
  text = text.replace(/ {2,}/g, ' ');
  // 4) 연속 빈 줄(3줄 이상) → 빈 줄 2줄로 축소
  text = text.replace(/\n{3,}/g, '\n\n');
  // 5) 앞뒤 공백 trim
  text = text.trim();

  return text;
}
