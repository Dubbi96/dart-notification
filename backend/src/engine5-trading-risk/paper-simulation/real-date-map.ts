/**
 * real-date-map.ts — 모의운용 REAL 매핑 모드의 거래일 매핑 (DAR-137, 순수 함수)
 *
 * 배경: 환경 시계가 미래(2026)라 실 KRX 에 2026 일봉이 없다. 그러나 사용자는 모의 보유종목을
 *   '실가격 변동'으로 평가하길 원한다. 그래서 실 KRX 의 '최신 가용 실데이터 시계열'을 모의
 *   캘린더에 매핑한다 — 시뮬 거래일(2026)을 N년 전 같은 날짜(예 2025)로 환산해 그 시점의
 *   실 StockDailyPrice 를 읽는다. 시뮬 날짜가 하루 전진하면 매핑 실날짜도 하루 전진 →
 *   일별 실가격 변동이 진입/Exit/스냅샷 평가에 반영된다(매핑 없으면 매일 같은 최신행 = 무변동).
 *
 * ★정직(불가침): 이 값은 '과거 실 KRX 데이터를 모의 캘린더에 매핑한 것'이다. 2026 실가격이
 *   아니다. 표시 시 반드시 'KRX 실데이터(원일자 YYYY-MM-DD) 매핑' 으로 고지한다(SimPriceRow.
 *   sourceDate = 매핑된 실 거래일). 합성가(SYNTHETIC)와 혼합/오인 표시 금지.
 *
 * 결정성: Date.now()/Math.random() 미사용. (simDate, yearOffset) → 항상 동일 결과.
 */

/** REAL 매핑 모드 연도 오프셋 기본값(시뮬 2026 → 실 2025). */
export const DEFAULT_REAL_YEAR_OFFSET = 1;

/**
 * REAL 매핑 모드 연도 오프셋 — 환경변수 PAPER_SIM_REAL_YEAR_OFFSET(정수≥1). 미설정/불량 시 기본 1.
 * 시뮬 연도에서 이만큼 빼서 실데이터 시계열에 정렬한다(가용 실데이터가 더 과거면 운영자가 키움).
 */
export function realYearOffset(): number {
  const raw = process.env.PAPER_SIM_REAL_YEAR_OFFSET;
  const n = raw != null ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n) || n < 1) return DEFAULT_REAL_YEAR_OFFSET;
  return Math.floor(n);
}

/** 윤년 판정(그레고리력). */
function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/**
 * 시뮬 거래일(YYYYMMDD)을 실데이터 거래일(YYYYMMDD)로 매핑 — 연도만 offset 만큼 과거로 이동.
 *   - MMDD 보존(계절성·요일 근사 유지) → 일별 전진이 실데이터에서도 전진.
 *   - 2/29 → 대상연도 비윤년이면 2/28 로 클램프(유효 날짜 보장).
 *   - 형식 불량(8자리 아님)은 입력을 그대로 반환(상위에서 graceful 처리).
 */
export function mapSimDateToRealDate(simDate: string, yearOffset: number): string {
  if (!/^\d{8}$/.test(simDate)) return simDate;
  const y = Number(simDate.slice(0, 4));
  const mm = simDate.slice(4, 6);
  let dd = simDate.slice(6, 8);

  const targetY = y - Math.max(1, Math.floor(yearOffset));
  if (mm === '02' && dd === '29' && !isLeapYear(targetY)) dd = '28';

  return `${String(targetY).padStart(4, '0')}${mm}${dd}`;
}
