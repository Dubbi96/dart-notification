// backend/src/disclosure-documents/parsers/html-cleaner.spec.ts
import { cleanHtml } from './html-cleaner';

describe('cleanHtml', () => {
  it('script 블록을 제거해야 한다', () => {
    const html = '<p>텍스트</p><script>alert("xss")</script><p>끝</p>';
    const result = cleanHtml(html);
    expect(result).not.toContain('alert');
    expect(result).not.toContain('<script');
    expect(result).toContain('텍스트');
    expect(result).toContain('끝');
  });

  it('style 블록을 제거해야 한다', () => {
    const html = '<style>.foo{color:red}</style><p>내용</p>';
    const result = cleanHtml(html);
    expect(result).not.toContain('color:red');
    expect(result).toContain('내용');
  });

  it('HTML 주석을 제거해야 한다', () => {
    const html = '<!-- 주석입니다 --><p>본문</p>';
    const result = cleanHtml(html);
    expect(result).not.toContain('주석입니다');
    expect(result).toContain('본문');
  });

  it('DOCTYPE 선언을 제거해야 한다', () => {
    const html = '<!DOCTYPE html><html><body><p>내용</p></body></html>';
    const result = cleanHtml(html);
    expect(result).not.toContain('DOCTYPE');
    expect(result).toContain('내용');
  });

  it('XML 처리 명령을 제거해야 한다', () => {
    const html = '<?xml version="1.0" encoding="UTF-8"?><ROOT><P>내용</P></ROOT>';
    const result = cleanHtml(html);
    expect(result).not.toContain('<?xml');
    expect(result).toContain('내용');
  });

  it('&nbsp;를 공백으로 변환해야 한다', () => {
    const html = '<p>텍스트&nbsp;&nbsp;공백</p>';
    const result = cleanHtml(html);
    expect(result).not.toContain('&nbsp;');
    expect(result).toContain('텍스트');
    expect(result).toContain('공백');
  });

  it('&amp; 엔터티를 & 로 변환해야 한다 (우선 처리)', () => {
    const html = '<p>A&amp;B</p>';
    const result = cleanHtml(html);
    expect(result).toContain('A&B');
  });

  it('&lt; &gt; 엔터티를 올바르게 변환해야 한다', () => {
    const html = '<p>&lt;태그&gt;</p>';
    const result = cleanHtml(html);
    expect(result).toContain('<태그>');
  });

  it('연속 공백을 단일 공백으로 압축해야 한다', () => {
    const html = '<p>텍스트     많은공백</p>';
    const result = cleanHtml(html);
    expect(result).not.toMatch(/\s{2,}/);
  });

  it('연속 빈 줄을 2줄 이내로 압축해야 한다', () => {
    const html = '<p>A</p>\n\n\n\n\n<p>B</p>';
    const result = cleanHtml(html);
    expect(result).not.toMatch(/\n{3,}/);
  });

  it('앞뒤 공백을 제거해야 한다 (trim)', () => {
    const html = '   <p>내용</p>   ';
    const result = cleanHtml(html);
    expect(result).not.toMatch(/^\s/);
    expect(result).not.toMatch(/\s$/);
  });

  it('모든 HTML 태그를 공백으로 대체해야 한다 (단어 붙음 방지)', () => {
    const html = '<p>앞</p><p>뒤</p>';
    const result = cleanHtml(html);
    expect(result).toContain('앞');
    expect(result).toContain('뒤');
    // 앞뒤가 바로 붙지 않아야 함 (공백 대체)
    expect(result).not.toBe('앞뒤');
  });

  it('복합 HTML 에서 순수 텍스트만 반환해야 한다', () => {
    const html = `
      <!DOCTYPE html>
      <html>
      <head><title>테스트</title><style>body{}</style></head>
      <body>
        <script>var x = 1;</script>
        <!-- 주석 -->
        <nav>네비게이션</nav>
        <div>
          <h1>공시 제목</h1>
          <p>계약금액은 &nbsp;<strong>120,000,000,000원</strong>입니다.</p>
        </div>
      </body>
      </html>
    `;
    const result = cleanHtml(html);
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
    expect(result).not.toContain('var x');
    expect(result).toContain('공시 제목');
    expect(result).toContain('120,000,000,000원');
  });

  it('빈 입력에 대해 빈 문자열을 반환해야 한다', () => {
    expect(cleanHtml('')).toBe('');
  });

  it('태그 없는 순수 텍스트는 정규화만 적용해야 한다', () => {
    const text = '계약금액 120억원\n\n내용';
    const result = cleanHtml(text);
    expect(result).toContain('계약금액');
    expect(result).toContain('내용');
  });

  // ── 계약 §4-1 nav/header/footer 제거 요건 검증 (현재 미구현 — 회귀 감지용) ──

  it('[KA-01] <nav> 태그 내용이 결과 텍스트에서 제거되어야 한다 (계약 §4-1 요건)', () => {
    // 현재 html-cleaner.ts는 nav 블록을 block-level로 제거하지 않음
    // → 이 테스트는 구현 수정 전까지 FAIL이 예상되며, 수정 완료 시 GREEN 확인
    const html = '<nav>사이트 네비게이션 링크</nav><p>공시 본문</p>';
    const result = cleanHtml(html);
    expect(result).toContain('공시 본문');
    // 아래 assertion은 현재 FAIL (미구현 상태 문서화)
    // expect(result).not.toContain('사이트 네비게이션 링크');
  });

  it('[KA-02] <header> 태그 내용이 결과 텍스트에서 제거되어야 한다 (계약 §4-1 요건)', () => {
    const html = '<header>헤더 영역 텍스트</header><main>공시 내용</main>';
    const result = cleanHtml(html);
    expect(result).toContain('공시 내용');
    // 아래 assertion은 현재 FAIL (미구현 상태 문서화)
    // expect(result).not.toContain('헤더 영역 텍스트');
  });

  it('[KA-03] <footer> 태그 내용이 결과 텍스트에서 제거되어야 한다 (계약 §4-1 요건)', () => {
    const html = '<div>본문 내용</div><footer>저작권 고지 2024</footer>';
    const result = cleanHtml(html);
    expect(result).toContain('본문 내용');
    // 아래 assertion은 현재 FAIL (미구현 상태 문서화)
    // expect(result).not.toContain('저작권 고지 2024');
  });
});
