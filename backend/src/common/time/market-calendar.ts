/**
 * market-calendar.ts — KRX 거래일·휴장일·반일장·월말거래일 단일 판정 모듈 (SSOT, DAR-481)
 *
 * ── 목적 ─────────────────────────────────────────────────────────────────────
 * 거래일 판정이 코드 3곳에 산재해 있었다(각각 다른 의미론):
 *   1) event-study/utils/d0-calculator.ts  — 평일 && 공휴일아님 (하드코딩 KNOWN_HOLIDAYS)
 *   2) backtest/ports/prisma-price-data.adapter.ts — 데이터 주도(일봉 실재일 = 거래일)
 *   3) market-data/krx-api.service.ts isWeekend / common/time/kst.ts — 주말만(공휴일 미반영)
 * 이 모듈은 (1)·(3)의 '캘린더 규칙' 판정을 한곳으로 수렴한다. 각 호출부는 자신의 기존
 * 의미론에 대응하는 함수로 **위임**하여 결과 동치(무행동 변경)를 유지한다. (2)의 데이터 주도
 * 판정은 성질이 달라(순수 함수가 아닌 DB 질의) 그대로 두되, `lastTradingDayOfMonth`가
 * 데이터 주도 실재일을 '권위 입력'으로 받아 캘린더 불완전 시 오발화를 방지한다.
 *
 * ── 이중 트랙(캘린더 규칙 vs 데이터 주도) 정합 ───────────────────────────────
 * 운영 데이터(일봉)는 '휴장일엔 존재하지 않으므로' 데이터 주도 판정이 사실상의 정답이다.
 * 이 하드코딩 캘린더는 (a) 데이터가 아직 없는 미래 시점(예약·리밸런싱 사전판정)과 (b) EventStudy
 * D0 산정처럼 접수시각→진입가능일 역산에서 필요하다. 두 트랙이 어긋날 위험을 낮추려 휴장일
 * 목록을 KRX 공식 기준으로 정확히 유지하고, 데이터가 있으면 데이터를 우선한다.
 *
 * ── ★연 1회 갱신 절차 (시한성 — 방치 시 하반기 공휴일을 거래일로 오인) ──────────
 * KRX 는 매년 말(통상 12월) 익년도 공식 휴장일을 공시한다(KIND). 매년 11~12월에:
 *   1) KRX/KIND 공식 '증시 휴장일' + 대체공휴일 + 근로자의날(5/1) + 연말 최종휴장일(12/31)을 확인.
 *   2) 설날·부처님오신날·추석은 음력→양력이라 반드시 공식 공시로 확인(계산 금지).
 *   3) 대체공휴일 규칙: 삼일절·광복절·개천절·한글날·어린이날은 토·일 겹치면 익영업일 대체.
 *      설날·추석은 '일요일' 겹칠 때만 대체(토요일은 대체 없음). 부처님오신날·성탄절도 대체 대상.
 *   4) 아래 KRX_HOLIDAYS 에 익년도 블록 추가. 수능일(지연개장)은 KRX_HALF_DAYS 에 추가.
 *   5) market-calendar.spec.ts 의 '연도 커버리지' 가드 테스트 갱신.
 * ※ 과거연도(2024·2025) 목록은 이력 재현성(EventStudy D0 회귀)을 위해 '동결'한다 — 소급 수정 금지.
 *   (DAR-481 시점에 2025 목록의 일부 누락이 있으나, 과거 D0 결과 불변을 위해 의도적으로 보존.)
 *
 * 포맷: 모든 날짜 인자·반환은 'YYYYMMDD'(KRX basDd 포맷). 시각 개념(장중/장후)은 kst.ts 담당.
 */
import {
  KRX_REGULAR_OPEN_MIN,
  KRX_REGULAR_CLOSE_MIN,
  formatKstDateCompact,
} from './kst';

/**
 * KRX 공식 휴장일 (YYYYMMDD). 평일이면 거래일 판정에 직접 영향, 주말과 겹치는 항목은
 * 기록·문서 목적(주말은 요일 판정으로 이미 비거래일). 갱신 절차는 파일 상단 주석 참조.
 */
export const KRX_HOLIDAYS: ReadonlySet<string> = new Set<string>([
  // ── 2024년 (동결 — 이력 재현성) ──
  '20240101', // 신정
  '20240209', '20240210', '20240212', // 설날(2/10) + 연휴·대체
  '20240301', // 삼일절
  '20240410', // 제22대 국회의원 선거일
  '20240501', // 근로자의날(KRX 휴장)
  '20240515', // 부처님오신날
  '20240606', // 현충일
  '20240815', // 광복절
  '20240916', '20240917', '20240918', // 추석
  '20241003', // 개천절
  '20241009', // 한글날
  '20241225', // 성탄절

  // ── 2025년 (동결 — 이력 재현성. 소급 수정 금지) ──
  '20250101', // 신정
  '20250128', '20250129', '20250130', // 설날 + 연휴
  '20250301', // 삼일절(토)
  '20250505', // 어린이날
  '20250506', // 대체공휴일(어린이날/부처님)
  '20250815', // 광복절
  '20251003', // 개천절
  '20251009', // 한글날
  '20251005', '20251006', '20251007', // 추석
  '20251225', // 성탄절

  // ── 2026년 (DAR-481 보강 — KRX 공식 기준 전체) ──
  // 근거: KRX/공휴일 공시. 대체공휴일 4건(3/2·5/25·8/17·10/5). 근로자의날·연말휴장 포함.
  '20260101', // 신정(목)
  '20260216', '20260217', '20260218', // 설날 연휴(월·화·수). 설날 당일=2/17(화)
  '20260301', // 삼일절(일) — 주말 겹침
  '20260302', // 대체공휴일(삼일절, 월)  ★거래일 영향
  '20260501', // 근로자의날(금, KRX 휴장)  ★거래일 영향
  '20260505', // 어린이날(화)
  '20260524', // 부처님오신날(일) — 주말 겹침
  '20260525', // 대체공휴일(부처님오신날, 월)  ★거래일 영향
  '20260606', // 현충일(토) — 주말 겹침
  '20260815', // 광복절(토) — 주말 겹침
  '20260817', // 대체공휴일(광복절, 월)  ★거래일 영향 — 이슈가 지목한 하반기 최초 위험일
  '20260924', '20260925', '20260926', // 추석 연휴(목·금·토). 추석 당일=9/25(금). 9/26(토) 주말·대체없음
  '20261003', // 개천절(토) — 주말 겹침
  '20261005', // 대체공휴일(개천절, 월)  ★거래일 영향
  '20261009', // 한글날(금)  ★거래일 영향
  '20261225', // 성탄절(금)
  '20261231', // 연말 최종휴장일(목). 마지막 거래일=12/30(수)  ★거래일 영향
]);

/** KRX 정규장 세션(자정 기준 분). 09:00~15:30. kst.ts 상수를 SSOT 로 재사용. */
export interface MarketSession {
  /** 개장(분, 0~1439). 예: 540 = 09:00 */
  openMin: number;
  /** 폐장(분, 0~1439). 예: 930 = 15:30 */
  closeMin: number;
}

/** 정규 세션(09:00~15:30). kst.ts 의 KRX_REGULAR_* 를 단일 소스로 사용. */
export const DEFAULT_MARKET_SESSION: MarketSession = {
  openMin: KRX_REGULAR_OPEN_MIN, // 540
  closeMin: KRX_REGULAR_CLOSE_MIN, // 930
};

/**
 * 반일장/지연개장(세션 override) — 거래일이지만 정규 09:00~15:30 이 아닌 날. YYYYMMDD → 세션.
 *
 * 대표 사례: 수능일(대학수학능력시험)은 개장·폐장이 1시간씩 순연 → 10:00~16:30.
 * ('반일장'은 과거 연말 폐장 반일장 관행에서 온 표현이나, 현재는 지연개장이 주 사례다.
 *  스키마는 open/close override 로 지연개장·조기폐장 양쪽을 포괄한다.)
 *
 * 갱신: 수능일은 매년 이동(통상 11월 셋째 목요일). 위 KRX_HOLIDAYS 갱신 시 함께 확인.
 * 주의: 현재 정규장 판정 hot-path(kst.isKstRegularMarketHours/kstIntradaySessionDate)는
 *   이 맵을 참조하지 않는다(M10 매매행동 무변경). 이 맵은 신규 세션-인지 소비자를 위한
 *   '주입 가능한 구조'다. 소비자가 세션 경계를 물을 때 getMarketSession(ymd) 를 쓴다.
 */
export const KRX_HALF_DAYS: ReadonlyMap<string, MarketSession> = new Map<string, MarketSession>([
  // 2026학년도 명칭상 '2027학년도 수능' = 2026-11-19(목). 개장·폐장 1시간 순연.
  ['20261119', { openMin: 10 * 60, closeMin: 16 * 60 + 30 }], // 10:00~16:30 (수능 지연개장)
]);

/** YYYYMMDD 형식 검증(8자리 숫자). 형식 불량은 명확한 에러로 거절(무성 오판 방지). */
function assertYmd(ymd: string): void {
  if (typeof ymd !== 'string' || !/^[0-9]{8}$/.test(ymd)) {
    throw new Error(
      `[MarketCalendar] 날짜는 8자리 YYYYMMDD 문자열이어야 합니다 (받음: ${JSON.stringify(ymd)})`,
    );
  }
}

/**
 * YYYYMMDD 의 요일(0=일 ~ 6=토). 시스템 TZ 무관(UTC 컴포넌트로 계산 — 달력 날짜의 요일은
 * TZ 불변). d0-calculator 의 `new Date(y,m,d).getDay()` 와 동일 결과를 낸다(회귀 동치).
 */
function dayOfWeek(ymd: string): number {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** YYYYMMDD 에 n일 가감(UTC 산술 — DST/로컬TZ 무관). */
function addDays(ymd: string, n: number): string {
  const y = Number(ymd.slice(0, 4));
  const m = Number(ymd.slice(4, 6));
  const d = Number(ymd.slice(6, 8));
  const t = Date.UTC(y, m - 1, d) + n * 86_400_000;
  const nd = new Date(t);
  const yy = nd.getUTCFullYear().toString();
  const mm = (nd.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = nd.getUTCDate().toString().padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

/** 주말 여부(토·일) — YYYYMMDD 기준(공휴일 미반영). */
export function isWeekend(ymd: string): boolean {
  assertYmd(ymd);
  const dow = dayOfWeek(ymd);
  return dow === 0 || dow === 6;
}

/**
 * 주말 여부(토·일) — Date 기준. krx-api.service.isWeekend 위임용(기존 `getDay()` 의미 그대로).
 * ★로컬 TZ getDay() 를 유지한다(기존 호출부 무행동 변경). KST 고정이 필요한 신규 코드는
 *   isWeekend(YYYYMMDD) 또는 kst.ts 를 사용할 것.
 */
export function isWeekendDate(date: Date): boolean {
  const dow = date.getDay();
  return dow === 0 || dow === 6;
}

/** 공휴일(KRX 휴장일) 여부 — YYYYMMDD. */
export function isHoliday(ymd: string): boolean {
  assertYmd(ymd);
  return KRX_HOLIDAYS.has(ymd);
}

/** KRX 거래일 여부 — 평일(월~금) && 공휴일 아님. d0-calculator.isKRXTradingDay 위임 대상. */
export function isTradingDay(ymd: string): boolean {
  assertYmd(ymd);
  if (KRX_HOLIDAYS.has(ymd)) return false;
  const dow = dayOfWeek(ymd);
  return dow >= 1 && dow <= 5;
}

/**
 * date 이후 첫 거래일(date 자신이 거래일이어도 다음 거래일 반환).
 * 연속 공휴일 방어로 최대 14일 순환 후 안전망 반환. d0-calculator.nextTradingDay 위임 대상.
 */
export function nextTradingDay(ymd: string): string {
  assertYmd(ymd);
  let candidate = addDays(ymd, 1);
  for (let i = 0; i < 14; i++) {
    if (isTradingDay(candidate)) return candidate;
    candidate = addDays(candidate, 1);
  }
  return candidate;
}

/** date 이전 첫 거래일(date 자신이 거래일이어도 이전 거래일 반환). */
export function prevTradingDay(ymd: string): string {
  assertYmd(ymd);
  let candidate = addDays(ymd, -1);
  for (let i = 0; i < 14; i++) {
    if (isTradingDay(candidate)) return candidate;
    candidate = addDays(candidate, -1);
  }
  return candidate;
}

/** 반일장/지연개장 여부(세션 override 등록일). */
export function isHalfDay(ymd: string): boolean {
  assertYmd(ymd);
  return KRX_HALF_DAYS.has(ymd);
}

/**
 * 해당 거래일의 세션 경계(자정 기준 분). 거래일이 아니면 null.
 * 반일장/지연개장 등록일은 override 세션, 그 외 정규 거래일은 DEFAULT_MARKET_SESSION.
 */
export function getMarketSession(ymd: string): MarketSession | null {
  if (!isTradingDay(ymd)) return null;
  return KRX_HALF_DAYS.get(ymd) ?? DEFAULT_MARKET_SESSION;
}

/**
 * '월 마지막 거래일' YYYYMMDD 산출 — Wave 1 P13(월말 리밸런싱) 전제.
 *
 * @param year  연도(예: 2026)
 * @param month 월(1~12)
 * @param opts.actualTradingDays
 *   해당 월 '일봉 실재일'(YYYYMMDD 배열, 정렬 불필요). 제공 시 이를 **권위 입력**으로 삼아
 *   그 달 최대값을 반환한다(운영 데이터는 휴장일에 존재하지 않으므로 사실상의 정답).
 *   → 캘린더가 불완전해도(누락 공휴일) 오발화하지 않는다(이슈 요구: 데이터 주도 폴백 필수).
 *   미제공/빈 배열이면 하드코딩 캘린더 규칙(월말→역방향 첫 거래일)으로 폴백한다.
 *
 * 데이터 우선 이유: 미래월(데이터 없음)은 캘린더로 사전판정하되, 당월/과거월은 실재 일봉이
 *   가장 신뢰 가능한 근거다. 리밸런싱 크론은 그 달의 실재 거래일을 넘겨 데이터 주도로 확정한다.
 */
export function lastTradingDayOfMonth(
  year: number,
  month: number,
  opts: { actualTradingDays?: readonly string[] } = {},
): string {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`[MarketCalendar] year/month 인자 오류 (year=${year}, month=${month})`);
  }
  const mm = String(month).padStart(2, '0');
  const prefix = `${year}${mm}`;

  // 1) 데이터 주도(권위): 해당 월 실재 일봉이 있으면 그 최대값이 실제 마지막 거래일.
  const actual = opts.actualTradingDays;
  if (actual && actual.length > 0) {
    const inMonth = actual.filter((d) => d.startsWith(prefix));
    if (inMonth.length > 0) {
      return inMonth.reduce((max, d) => (d > max ? d : max));
    }
  }

  // 2) 캘린더 규칙 폴백: 월 마지막 날부터 역방향으로 첫 거래일.
  const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate(); // month 0-based 다음달 0일 = 이번달 말일
  let candidate = `${prefix}${String(lastDayOfMonth).padStart(2, '0')}`;
  for (let i = 0; i <= lastDayOfMonth; i++) {
    if (isTradingDay(candidate)) return candidate;
    candidate = addDays(candidate, -1);
  }
  // 안전망: 한 달 전체가 비거래(불가능) — 월말일 반환.
  return `${prefix}${String(lastDayOfMonth).padStart(2, '0')}`;
}

/**
 * ymd 가 그 달의 마지막 거래일인지. P13 리밸런싱 크론의 발화 판정용.
 * opts.actualTradingDays 를 넘기면 데이터 주도로 확정(캘린더 불완전 오발화 방지).
 */
export function isLastTradingDayOfMonth(
  ymd: string,
  opts: { actualTradingDays?: readonly string[] } = {},
): boolean {
  assertYmd(ymd);
  const year = Number(ymd.slice(0, 4));
  const month = Number(ymd.slice(4, 6));
  return ymd === lastTradingDayOfMonth(year, month, opts);
}

/** Date → 그 KST 거래일의 마지막 거래일 여부(편의 래퍼). 시각은 무시(날짜만). */
export function isLastTradingDayOfMonthDate(
  date: Date,
  opts: { actualTradingDays?: readonly string[] } = {},
): boolean {
  return isLastTradingDayOfMonth(formatKstDateCompact(date), opts);
}
