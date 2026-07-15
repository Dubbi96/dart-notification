import {
  escapeHtml,
  extractSummaryText,
  formatRcpDt,
  renderLandingHtml,
  renderNotFoundHtml,
  renderSharePageHtml,
  truncateForOg,
  APP_DEEP_LINK_SCHEME,
} from './share-page.renderer';

describe('share-page.renderer', () => {
  const baseInput = {
    rcpNo: '20260714000123',
    corpName: '삼성전자',
    reportName: '주요사항보고서(유상증자결정)',
    rcpDt: '20260714',
    summary: null as string | null,
  };

  describe('renderSharePageHtml — 캐시 요약 유무 분기', () => {
    it('캐시 요약이 있으면 요약 섹션과 og:description에 요약이 들어간다', () => {
      const html = renderSharePageHtml({
        ...baseInput,
        summary: '유상증자 결정으로 자본 확충 예정.',
      });

      expect(html).toContain('AI 요약');
      expect(html).toContain('유상증자 결정으로 자본 확충 예정.');
      expect(html).toContain(
        '<meta property="og:description" content="유상증자 결정으로 자본 확충 예정.">',
      );
      // 참고용 고지 동반
      expect(html).toContain('AI가 생성한 참고용 요약입니다.');
    });

    it('캐시 요약이 없으면 요약 섹션을 생략하고 og:description은 공시 기본 정보로 대체한다', () => {
      const html = renderSharePageHtml(baseInput);

      expect(html).not.toContain('AI 요약');
      expect(html).not.toContain('AI가 생성한 참고용 요약입니다.');
      expect(html).toContain('삼성전자의 공시 · 접수일 2026.07.14');
    });

    it('공시 제목·회사명·접수일·앱 딥링크를 항상 포함한다', () => {
      const html = renderSharePageHtml(baseInput);

      expect(html).toContain('삼성전자');
      expect(html).toContain('주요사항보고서(유상증자결정)');
      expect(html).toContain('접수일 2026.07.14');
      expect(html).toContain(`${APP_DEEP_LINK_SCHEME}://disclosure/20260714000123`);
      expect(html).toContain('앱에서 보기');
      // og 필수 메타
      expect(html).toContain('og:title');
      expect(html).toContain('삼성전자 · 주요사항보고서(유상증자결정)');
      // 면책 고지
      expect(html).toContain('투자판단 참고용');
    });

    it('외부 유래 텍스트(제목·요약)의 HTML 특수문자를 이스케이프한다 (XSS 차단)', () => {
      const html = renderSharePageHtml({
        ...baseInput,
        reportName: '<script>alert(1)</script>',
        summary: '"인용" & <b>강조</b>',
      });

      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(html).not.toContain('<b>강조</b>');
      expect(html).toContain('&quot;인용&quot; &amp; &lt;b&gt;강조&lt;/b&gt;');
    });

    it('긴 요약은 og:description에서 절단되지만 본문에는 전문이 남는다', () => {
      const longSummary = '가'.repeat(300);
      const html = renderSharePageHtml({ ...baseInput, summary: longSummary });

      expect(html).toContain(longSummary); // 본문 전문
      expect(html).toContain(`${'가'.repeat(159)}…`); // og 절단본
    });
  });

  describe('renderNotFoundHtml — 404 분기', () => {
    it('안내 문구·랜딩 링크·noindex를 포함한다', () => {
      const html = renderNotFoundHtml();

      expect(html).toContain('공시를 찾을 수 없습니다');
      expect(html).toContain('href="/"');
      expect(html).toContain('<meta name="robots" content="noindex">');
    });
  });

  describe('renderLandingHtml', () => {
    it('서비스 소개 3줄과 면책 고지를 포함한다', () => {
      const html = renderLandingHtml();

      expect(html).toContain('DART 전자공시를 실시간으로 수집해 푸시 알림으로 전달합니다.');
      expect(html).toContain('AI 요약과 이벤트 분석으로 공시의 핵심을 몇 초 만에 파악할 수 있습니다.');
      expect(html).toContain(
        '워치리스트부터 포트폴리오 점검까지, 투자 판단에 필요한 흐름을 한 곳에서 확인합니다.',
      );
      expect(html).toContain('투자판단 참고용이며, 매수·매도 권유가 아닙니다');
    });
  });

  describe('extractSummaryText', () => {
    it('resultJson.summary 문자열을 추출한다', () => {
      expect(extractSummaryText({ summary: '요약문', polarity: 'POSITIVE' })).toBe('요약문');
    });

    it('공백뿐이거나 문자열이 아니면 null (요약 섹션 생략으로 수렴)', () => {
      expect(extractSummaryText({ summary: '   ' })).toBeNull();
      expect(extractSummaryText({ summary: 42 })).toBeNull();
      expect(extractSummaryText({ polarity: 'NEUTRAL' })).toBeNull();
      expect(extractSummaryText(null)).toBeNull();
      expect(extractSummaryText('요약문')).toBeNull();
      expect(extractSummaryText(undefined)).toBeNull();
    });
  });

  describe('formatRcpDt', () => {
    it('YYYYMMDD·YYYYMMDDHHmmss 를 YYYY.MM.DD 로 변환한다', () => {
      expect(formatRcpDt('20260714')).toBe('2026.07.14');
      expect(formatRcpDt('20260714093000')).toBe('2026.07.14');
    });

    it('형식 미달은 원문을 그대로 반환한다', () => {
      expect(formatRcpDt('2026-07')).toBe('2026-07');
    });
  });

  describe('escapeHtml / truncateForOg', () => {
    it('HTML 특수문자 5종을 이스케이프한다', () => {
      expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
    });

    it('최대 길이 초과 시 말줄임표로 절단한다', () => {
      expect(truncateForOg('12345', 5)).toBe('12345');
      expect(truncateForOg('123456', 5)).toBe('1234…');
    });
  });
});
