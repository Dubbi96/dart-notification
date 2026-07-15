import { PublicStatusSnapshot } from './status.service';

// [W11/W12] 공개 /status HTML 뷰 — 순수 함수(스냅샷 → HTML 문자열).
// ★운영 사실만 렌더한다(성과·수익률 미표시). 값은 전부 내부 집계 산출(사용자 입력 없음)이나
//   방어적으로 이스케이프한다. 외부 자산(CDN/폰트) 로드 없음 — 단일 self-contained 페이지.

const KST_FORMATTER = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtKst(iso: string | null): string {
  if (!iso) return '기록 없음';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '기록 없음';
  return `${KST_FORMATTER.format(date)} KST`;
}

function fmtUptime(seconds: number): string {
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}일 ${hours}시간`;
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  return `${minutes}분`;
}

function badge(ok: boolean, okLabel: string, badLabel: string): string {
  const cls = ok ? 'ok' : 'warn';
  return `<span class="badge ${cls}">${esc(ok ? okLabel : badLabel)}</span>`;
}

/** 스냅샷 → 공개 상태 HTML 1장. */
export function renderStatusHtml(s: PublicStatusSnapshot): string {
  const serviceOk = s.service.status === 'OK';
  const pipelineOk = s.pipeline.status === 'OK';
  const rate =
    s.cron.successRatePct == null
      ? '집계 대상 없음'
      : `${s.cron.successRatePct}% (${s.cron.okRuns}/${s.cron.totalRuns}회)`;

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>공시온 시스템 상태</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 24px 16px; font-family: -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; background: #f6f8f8; color: #16302e; }
  @media (prefers-color-scheme: dark) { body { background: #101817; color: #e2ecea; } .card { background: #1a2423 !important; border-color: #2b3a38 !important; } .muted { color: #8aa19d !important; } }
  main { max-width: 640px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .muted { color: #5c7370; font-size: 13px; }
  .card { background: #fff; border: 1px solid #dce6e4; border-radius: 12px; padding: 16px; margin-top: 16px; }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding: 6px 0; }
  .row + .row { border-top: 1px solid rgba(128,150,147,.18); }
  .k { font-size: 14px; }
  .v { font-size: 14px; font-weight: 600; text-align: right; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 13px; font-weight: 700; }
  .badge.ok { background: rgba(13,148,136,.14); color: #0d9488; }
  .badge.warn { background: rgba(217,119,6,.16); color: #b45309; }
  footer { margin-top: 20px; font-size: 12px; line-height: 1.6; }
</style>
</head>
<body>
<main>
  <h1>공시온 시스템 상태</h1>
  <p class="muted">생성 ${esc(fmtKst(s.generatedAt))} · 60초마다 자동 갱신</p>

  <section class="card">
    <div class="row"><span class="k">서비스 가동 상태</span><span class="v">${badge(serviceOk, '정상 가동', '일부 수집 지연')}</span></div>
    <div class="row"><span class="k">서버 연속 가동</span><span class="v">${esc(fmtUptime(s.service.uptimeSeconds))}</span></div>
  </section>

  <section class="card">
    <div class="row"><span class="k">오늘 공시 수집</span><span class="v">${s.disclosure.todayCollectedCount.toLocaleString('ko-KR')}건</span></div>
    <div class="row"><span class="k">마지막 수집 성공</span><span class="v">${esc(fmtKst(s.disclosure.lastCollectedAt))}</span></div>
    <div class="row"><span class="k">파싱 파이프라인</span><span class="v">${badge(pipelineOk, '정상', '지연')}</span></div>
  </section>

  <section class="card">
    <div class="row"><span class="k">최근 ${s.cron.windowHours}시간 크론 성공률</span><span class="v">${esc(rate)}</span></div>
  </section>

  <footer class="muted">
    본 페이지는 시스템 가동 사실(수집·배치 상태)만 표시합니다. 투자 성과·수익률 정보를 포함하지 않으며,
    표시 내용은 투자 판단의 근거가 아닙니다. JSON: <a href="/status.json">/status.json</a>
  </footer>
</main>
</body>
</html>`;
}
