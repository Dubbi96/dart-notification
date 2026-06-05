/**
 * d0-calculator.ts — D0 날짜 결정 로직 (M5-A, DAR-9)
 *
 * KRX 거래일 기준:
 * - 월~금 (공휴일 제외)
 * - 장 마감 기준: 15:20 이전 접수 → 당일 D0
 *                 15:20 이후 또는 날짜만 알 경우 → 보수적으로 다음 거래일
 */

/**
 * KRX 공식 휴장일 (하드코딩, 2024-2026 주요 공휴일)
 */
const KNOWN_HOLIDAYS = new Set<string>([
  // 2024년
  '20240101', // 신정
  '20240209', '20240210', '20240212', // 설날 (2/10 당일 + 연휴)
  '20240301', // 삼일절
  '20240410', // 국회의원 선거일
  '20240501', // 근로자의날 (KRX 휴장)
  '20240515', // 부처님오신날
  '20240606', // 현충일
  '20240815', // 광복절
  '20240916', '20240917', '20240918', // 추석
  '20241003', // 개천절
  '20241009', // 한글날
  '20241225', // 크리스마스

  // 2025년
  '20250101', // 신정
  '20250128', '20250129', '20250130', // 설날
  '20250301', // 삼일절
  '20250505', // 어린이날
  '20250506', // 대체공휴일
  '20250815', // 광복절
  '20251003', // 개천절
  '20251009', // 한글날
  '20251005', '20251006', '20251007', // 추석
  '20251225', // 크리스마스

  // 2026년
  '20260101', // 신정
  '20260216', '20260217', '20260218', // 설날
  '20260301', // 삼일절
  '20260505', // 어린이날
  '20261225', // 크리스마스
]);

/**
 * 해당 날짜가 KRX 거래일인지 확인
 * - 월요일(1)~금요일(5) && 공휴일 아님
 */
export function isKRXTradingDay(date: string): boolean {
  if (KNOWN_HOLIDAYS.has(date)) return false;
  const year = parseInt(date.slice(0, 4), 10);
  const month = parseInt(date.slice(4, 6), 10) - 1;
  const day = parseInt(date.slice(6, 8), 10);
  const d = new Date(year, month, day);
  const dayOfWeek = d.getDay(); // 0=일, 1=월, ..., 6=토
  return dayOfWeek >= 1 && dayOfWeek <= 5;
}

/**
 * YYYYMMDD 문자열에 N일을 더한 날짜 반환
 */
function addDays(date: string, n: number): string {
  const year = parseInt(date.slice(0, 4), 10);
  const month = parseInt(date.slice(4, 6), 10) - 1;
  const day = parseInt(date.slice(6, 8), 10);
  const d = new Date(year, month, day);
  d.setDate(d.getDate() + n);
  const y = d.getFullYear().toString();
  const mo = (d.getMonth() + 1).toString().padStart(2, '0');
  const da = d.getDate().toString().padStart(2, '0');
  return `${y}${mo}${da}`;
}

/**
 * date 이후 첫 번째 KRX 거래일 (date 자신이 거래일이어도 다음 거래일 반환)
 */
export function nextTradingDay(date: string): string {
  let candidate = addDays(date, 1);
  // 최대 14일 순환 (연속 공휴일 방어)
  for (let i = 0; i < 14; i++) {
    if (isKRXTradingDay(candidate)) return candidate;
    candidate = addDays(candidate, 1);
  }
  // 안전망: 그냥 반환
  return candidate;
}

/**
 * 공시 접수 정보로부터 D0 날짜를 결정한다.
 *
 * @param rcpDt 접수일시: YYYYMMDD (8자리) 또는 YYYYMMDDHHmmss (14자리)
 * @returns D0 날짜 YYYYMMDD
 *
 * 규칙:
 * 1. rcpDt가 8자리(날짜만) → 시간 불명 → 보수적으로 nextTradingDay
 * 2. rcpDt가 14자리(날짜+시각):
 *    - 해당 날짜가 KRX 거래일 && 시각 <= 15:20 → 당일 D0
 *    - 그 외(장 마감 후, 주말, 공휴일) → nextTradingDay
 */
export function calcD0(rcpDt: string): string {
  const dateStr = rcpDt.slice(0, 8); // YYYYMMDD 부분

  if (rcpDt.length >= 14) {
    // YYYYMMDDHHmmss 형식
    const hh = parseInt(rcpDt.slice(8, 10), 10);
    const mm = parseInt(rcpDt.slice(10, 12), 10);
    const timeMinutes = hh * 60 + mm; // 분 단위로 변환
    const cutoffMinutes = 15 * 60 + 20; // 15:20

    if (isKRXTradingDay(dateStr) && timeMinutes <= cutoffMinutes) {
      return dateStr;
    }
    return nextTradingDay(dateStr);
  }

  // 8자리 날짜만 → 보수적으로 다음 거래일
  return nextTradingDay(dateStr);
}
