// utils/editionSummary.ts — 홈 '최신 에디션 요약' 카드(DAR-508/517) 순수 파생 헬퍼.
//
// 에디션 날짜 키는 KST 거래일 compact 'YYYYMMDD'(백엔드 tradeDateFromMs 동형). 이 파일은
// RN/expo 무의존 순수 함수만 담아 결정론 단위검증이 가능하다(HomeSignalPreview 가 소비).
// 날짜 라벨/간극은 이미 KST 달력일로 확정된 두 문자열을 비교할 뿐이라 디바이스 타임존 무관.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 'YYYYMMDD' → UTC epoch ms(그 날 자정). 형식/롤오버(예 20260230) 무효면 null.
 * KST 달력일을 그대로 UTC 자정으로 취급 — 두 에디션 날짜의 '일수 차'만 쓰므로 TZ 무의존.
 */
function ymdToUtcMs(ymd: string | null | undefined): number | null {
  if (!ymd || !/^\d{8}$/.test(ymd)) return null;
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  const ms = Date.UTC(y, m - 1, d);
  // 롤오버 검증(2026-02-30 → 3-02 로 넘어감)을 왕복 비교로 차단.
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return ms;
}

/**
 * 두 에디션 날짜(YYYYMMDD) 사이 '달력 일수'. from(과거)→to(오늘) 방향.
 * 정체일 'N일 전' hero 배너 산출(DAR-517 §4). 어느 하나라도 무효면 null.
 * 예: editionDayGap('20260713','20260716') === 3.
 */
export function editionDayGap(
  fromYmd: string | null | undefined,
  toYmd: string | null | undefined,
): number | null {
  const a = ymdToUtcMs(fromYmd);
  const b = ymdToUtcMs(toYmd);
  if (a === null || b === null) return null;
  return Math.round((b - a) / DAY_MS);
}

/**
 * 'YYYYMMDD' → 'M/D'(예: '20260715' → '7/15'). 빈 상태 CTA·간극 배너의 날짜 명시용
 * (DAR-517 §3 '날짜 명시 필수'). 형식 불일치면 null(호출부가 결측 처리).
 */
export function ymdToMonthDay(ymd: string | null | undefined): string | null {
  const ms = ymdToUtcMs(ymd);
  if (ms === null) return null;
  const d = new Date(ms);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
