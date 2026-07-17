// DAR-538: D-day 표기 유틸 — 예정 이벤트 캘린더의 표기 SSOT.
// dDay 값 자체는 서버(baseDate 기준)가 계산해 내려준다(FE 재계산 금지 — 시계 이원화 방지).

/** D-day 칩 표기: 0 → 'D-Day', 3 → 'D-3', 지난 이벤트(-2) → 'D+2' */
export function formatDday(dDay: number): string {
  if (!Number.isFinite(dDay)) return '';
  if (dDay === 0) return 'D-Day';
  return dDay > 0 ? `D-${dDay}` : `D+${Math.abs(dDay)}`;
}

/** 스크린리더용 D-day 문구: 'D-3' 같은 축약 대신 자연어 */
export function ddayA11yLabel(dDay: number): string {
  if (!Number.isFinite(dDay)) return '';
  if (dDay === 0) return '오늘';
  return dDay > 0 ? `${dDay}일 후` : `${Math.abs(dDay)}일 지남`;
}

/** 임박(오늘~3일 내) 여부 — 칩 강조 톤 분기 */
export function isImminentDday(dDay: number): boolean {
  return Number.isFinite(dDay) && dDay >= 0 && dDay <= 3;
}

/** 'YYYY-MM-DD' → '8월 3일' (a11y 병기용). 형식 불일치는 null — 발명 금지. */
export function ymdToKoreanMonthDay(ymd: string | null | undefined): string | null {
  if (!ymd) return null;
  const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return `${Number(m[2])}월 ${Number(m[3])}일`;
}
