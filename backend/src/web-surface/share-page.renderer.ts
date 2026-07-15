/**
 * 웹 표면(W3b) — 공개 공유 페이지·랜딩 HTML 렌더러 (순수 함수).
 *
 * 설계 원칙:
 *  - 서버 렌더 정적 HTML만 생성한다. 외부 API 호출 0 (DART 쿼터 무접촉이 절대 조건).
 *  - 입력은 전부 DB 캐시(Disclosure·DisclosureAnalysis)에서 온 read-only 데이터.
 *  - 모든 동적 문자열은 escapeHtml 로 이스케이프(공시 제목·LLM 요약 모두 외부 유래 텍스트).
 *  - 재계산·신규 AI 호출 절대 금지 — 캐시된 요약이 없으면 요약 섹션을 생략한다.
 */

/** 앱 딥링크 스킴 — 모바일 app.json scheme(gongsion)과 정합 */
export const APP_DEEP_LINK_SCHEME = 'gongsion';

/** 공유 페이지 렌더 입력 (DB 캐시에서 조회된 값만) */
export interface SharePageInput {
  rcpNo: string;
  corpName: string;
  reportName: string;
  /** 접수일시 YYYYMMDD 또는 YYYYMMDDHHmmss */
  rcpDt: string;
  /** DisclosureAnalysis(summary task) 캐시 요약 — 없으면 null(섹션 생략) */
  summary: string | null;
}

/** HTML 특수문자 이스케이프 — 요소 본문·속성 컨텍스트 공용 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 접수일시(YYYYMMDD[HHmmss]) → 'YYYY.MM.DD' 표기. 형식 미달 시 원문 반환 */
export function formatRcpDt(rcpDt: string): string {
  if (!/^\d{8}/.test(rcpDt)) return rcpDt;
  return `${rcpDt.slice(0, 4)}.${rcpDt.slice(4, 6)}.${rcpDt.slice(6, 8)}`;
}

/**
 * DisclosureAnalysis.resultJson(summary task)에서 요약 텍스트만 안전 추출.
 * 형식이 어긋나면 null — 요약 섹션 생략 분기로 수렴(오류 페이지 아님).
 */
export function extractSummaryText(resultJson: unknown): string | null {
  if (typeof resultJson !== 'object' || resultJson === null) return null;
  const summary = (resultJson as Record<string, unknown>).summary;
  if (typeof summary !== 'string') return null;
  const trimmed = summary.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** og:description 용 요약 절단(카톡/링크 미리보기 관례 ~160자) */
export function truncateForOg(text: string, maxLength = 160): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}

const DISCLAIMER_TEXT = '본 페이지의 정보는 투자판단 참고용이며, 매수·매도 권유가 아닙니다.';

/** 공통 셸 — 인라인 CSS만 사용(외부 리소스 요청 0) */
function renderShell(params: {
  title: string;
  metaTags: string;
  body: string;
}): string {
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${params.title}</title>
${params.metaTags}
<style>
  :root { color-scheme: light dark; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; background: #f6f8f8; color: #1a2e2b; line-height: 1.6; }
  .wrap { max-width: 560px; margin: 0 auto; padding: 32px 20px 48px; }
  .brand { font-size: 15px; font-weight: 700; color: #0d9488; margin-bottom: 24px; }
  .card { background: #ffffff; border: 1px solid #e2e8e8; border-radius: 16px; padding: 24px 20px; }
  .corp { font-size: 14px; color: #5b6b69; margin-bottom: 4px; }
  h1 { font-size: 20px; font-weight: 700; margin-bottom: 8px; word-break: keep-all; }
  .date { font-size: 13px; color: #8a9694; margin-bottom: 16px; }
  .section-label { font-size: 12px; font-weight: 700; color: #0d9488; margin-bottom: 6px; }
  .summary { font-size: 15px; color: #33403e; white-space: pre-wrap; word-break: keep-all; }
  .summary-note { font-size: 12px; color: #8a9694; margin-top: 8px; }
  .cta { display: block; text-align: center; margin-top: 24px; padding: 14px 16px; background: #0d9488; color: #ffffff; border-radius: 12px; text-decoration: none; font-size: 16px; font-weight: 700; }
  .intro { font-size: 15px; color: #33403e; margin-bottom: 10px; word-break: keep-all; }
  .disclaimer { margin-top: 28px; font-size: 12px; color: #8a9694; text-align: center; word-break: keep-all; }
  .home-link { display: inline-block; margin-top: 16px; font-size: 14px; color: #0d9488; text-decoration: none; }
  @media (prefers-color-scheme: dark) {
    body { background: #101817; color: #e6efee; }
    .card { background: #182321; border-color: #263230; }
    h1 { color: #e6efee; }
    .summary { color: #c4d1cf; }
    .intro { color: #c4d1cf; }
  }
</style>
</head>
<body>
<div class="wrap">
${params.body}
</div>
</body>
</html>`;
}

/** 공시 공유 페이지 — og 메타 + 제목·회사명·접수일 (+캐시 요약 있으면 표시) + 앱 딥링크 */
export function renderSharePageHtml(input: SharePageInput): string {
  const corpName = escapeHtml(input.corpName);
  const reportName = escapeHtml(input.reportName);
  const rcpDate = escapeHtml(formatRcpDt(input.rcpDt));
  const deepLink = `${APP_DEEP_LINK_SCHEME}://disclosure/${encodeURIComponent(input.rcpNo)}`;

  const ogTitle = escapeHtml(`${input.corpName} · ${input.reportName}`);
  const ogDescription = escapeHtml(
    input.summary
      ? truncateForOg(input.summary)
      : `${input.corpName}의 공시 · 접수일 ${formatRcpDt(input.rcpDt)} — 공시온 앱에서 자세히 확인하세요.`,
  );

  const metaTags = [
    `<meta property="og:title" content="${ogTitle}">`,
    `<meta property="og:description" content="${ogDescription}">`,
    `<meta property="og:type" content="article">`,
    `<meta property="og:site_name" content="공시온">`,
  ].join('\n');

  // 캐시된 요약이 있을 때만 요약 섹션 렌더(없으면 생략 — 재계산·신규 AI 호출 금지)
  const summarySection = input.summary
    ? `<div style="margin-top:20px">
  <div class="section-label">AI 요약</div>
  <p class="summary">${escapeHtml(input.summary)}</p>
  <p class="summary-note">AI가 생성한 참고용 요약입니다.</p>
</div>`
    : '';

  const body = `<div class="brand">공시온</div>
<div class="card">
  <p class="corp">${corpName}</p>
  <h1>${reportName}</h1>
  <p class="date">접수일 ${rcpDate}</p>
${summarySection}
</div>
<a class="cta" href="${escapeHtml(deepLink)}">앱에서 보기</a>
<p class="disclaimer">${DISCLAIMER_TEXT}</p>`;

  return renderShell({
    title: ogTitle,
    metaTags,
    body,
  });
}

/** 존재하지 않는 rcpNo — 404 페이지 */
export function renderNotFoundHtml(): string {
  const body = `<div class="brand">공시온</div>
<div class="card">
  <h1>공시를 찾을 수 없습니다</h1>
  <p class="intro">요청하신 공시가 존재하지 않거나 아직 수집되지 않았습니다.</p>
  <a class="home-link" href="/">공시온 소개 보기 →</a>
</div>
<p class="disclaimer">${DISCLAIMER_TEXT}</p>`;

  return renderShell({
    title: '공시를 찾을 수 없습니다 · 공시온',
    metaTags: [
      `<meta property="og:title" content="공시를 찾을 수 없습니다 · 공시온">`,
      `<meta property="og:description" content="요청하신 공시가 존재하지 않거나 아직 수집되지 않았습니다.">`,
      `<meta name="robots" content="noindex">`,
    ].join('\n'),
    body,
  });
}

/** 초미니 랜딩 — 서비스 소개 3줄 + 면책 고지 */
export function renderLandingHtml(): string {
  const body = `<div class="brand">공시온</div>
<div class="card">
  <h1>DART 공시, 놓치지 않게</h1>
  <p class="intro" style="margin-top:12px">관심기업의 DART 전자공시를 실시간으로 수집해 푸시 알림으로 전달합니다.</p>
  <p class="intro">AI 요약과 이벤트 분석으로 공시의 핵심을 몇 초 만에 파악할 수 있습니다.</p>
  <p class="intro">워치리스트부터 포트폴리오 점검까지, 투자 판단에 필요한 흐름을 한 곳에서 확인합니다.</p>
</div>
<p class="disclaimer">본 서비스가 제공하는 모든 정보는 투자판단 참고용이며, 매수·매도 권유가 아닙니다.</p>`;

  return renderShell({
    title: '공시온 — DART 공시 알림',
    metaTags: [
      `<meta property="og:title" content="공시온 — DART 공시 알림">`,
      `<meta property="og:description" content="DART 전자공시 실시간 알림 + AI 요약. 투자판단 참고용 정보를 제공합니다.">`,
      `<meta property="og:type" content="website">`,
      `<meta property="og:site_name" content="공시온">`,
    ].join('\n'),
    body,
  });
}
