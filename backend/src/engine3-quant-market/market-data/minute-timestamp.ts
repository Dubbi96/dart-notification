/**
 * 분봉 시각 변환 유틸 (DAR-381) — 거래일(YYYYMMDD)+체결시각(HHMM) ↔ ts(파티션 키) 상호변환.
 *
 * StockMinutePrice 는 TimescaleDB 하이퍼테이블이라 파티션 키 ts(분 단위 instant)를 PK 로 쓴다(#334).
 * 반면 KIS 분봉 수집(#333)·legacy minute-candles 조회는 거래일+HHMM 문자열을 다룬다. 둘을 잇기 위해
 * ts 를 'KST 거래일 09:00~15:30 의 벽시계 시각을 그대로 담은 분 단위 instant'로 정의한다:
 *   ts = Date.UTC(year, month-1, day, HH, MM)  (KST HHMM 을 UTC 컴포넌트로 그대로 저장)
 *
 * 이 정의는 TimescaleDB 의 timestamp(no tz) 컬럼에 KST 벽시계가 그대로 보관되게 하고,
 *   - time_bucket('1 day', ts) 가 KST 거래일 경계(자정)와 정렬되며,
 *   - candle-query 의 compact(YYYYMMDDHHmm, UTC 해석) 파싱과도 동일 instant 로 일치한다.
 * 순수 함수(시계·DB 비의존) — 결정론적 단위 테스트 가능.
 */

/** 거래일(YYYYMMDD)+HHMM → 분 단위 ts(Date). 형식 불량/비현실 시각이면 null. */
export function minuteTimestamp(tradeDate: string, hhmm: string): Date | null {
  if (!/^\d{8}$/.test(tradeDate) || !/^\d{4}$/.test(hhmm)) return null;
  const year = Number(tradeDate.slice(0, 4));
  const month = Number(tradeDate.slice(4, 6));
  const day = Number(tradeDate.slice(6, 8));
  const hour = Number(hhmm.slice(0, 2));
  const minute = Number(hhmm.slice(2, 4));
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    return null;
  }
  const ms = Date.UTC(year, month - 1, day, hour, minute);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/** ts(Date) → 체결시각 HHMM(KST 벽시계 = UTC 컴포넌트). */
export function hhmmFromTs(ts: Date): string {
  const hh = String(ts.getUTCHours()).padStart(2, '0');
  const mm = String(ts.getUTCMinutes()).padStart(2, '0');
  return `${hh}${mm}`;
}

/** ts(Date) → 거래일 YYYYMMDD(KST 벽시계 = UTC 컴포넌트). */
export function tradeDateFromTs(ts: Date): string {
  const y = String(ts.getUTCFullYear()).padStart(4, '0');
  const m = String(ts.getUTCMonth() + 1).padStart(2, '0');
  const d = String(ts.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}
