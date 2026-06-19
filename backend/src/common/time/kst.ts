/**
 * 한국 표준시(KST, Asia/Seoul) 시간 유틸 — 시스템 TZ 비의존 단일 소스.
 *
 * 배경(DAR-199): 컨테이너 기본 TZ는 UTC다. @nestjs/schedule `@Cron`은 `timeZone`
 * 옵션이 없으면 시스템 TZ로 cron식을 해석하므로, KST 벽시계를 가정한 스케줄이
 * UTC 서버에서 9시간 어긋나 발화한다. 또한 `Date.getFullYear/Month/Date`(로컬 TZ)
 * 로 날짜를 만들면 UTC 새벽(KST 00~09시)에 전일 날짜를 반환해 당일 공시·일봉이
 * 누락된다. 이 모듈은 두 문제의 공통 처방을 한곳에 모은다.
 *
 * - `@Cron(expr, { timeZone: KST_TIMEZONE })` 로 발화 시각을 KST로 고정.
 * - `formatKstDate*` 로 "오늘"을 KST 거래일로 고정(Intl, 시스템 TZ 무관).
 *
 * DAR-198 `MarketCalendarService`의 KST 명시 계산과 동일 클래스의 시스템 차원 처방.
 */

/** @nestjs/schedule `@Cron`의 `timeZone` 옵션·Intl 포맷의 단일 소스. */
export const KST_TIMEZONE = 'Asia/Seoul';

/**
 * en-CA 로케일은 'YYYY-MM-DD' 순서로 포맷한다(ISO 정렬 가능). timeZone을 고정하면
 * 입력 Date의 절대 시각을 KST 벽시계 날짜로 환산해 시스템 TZ와 무관하게 동작한다.
 */
const KST_YMD = new Intl.DateTimeFormat('en-CA', {
  timeZone: KST_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Date → 'YYYY-MM-DD' (KST 거래일 기준, 시스템 TZ 무관). */
export function formatKstDateDashed(date: Date): string {
  return KST_YMD.format(date);
}

/** Date → 'YYYYMMDD' (KST 거래일 기준, 시스템 TZ 무관). DART/KRX basDd 포맷. */
export function formatKstDateCompact(date: Date): string {
  return KST_YMD.format(date).replace(/-/g, '');
}

/** KST 기준 연도(YYYY). 시스템 TZ 무관 — UTC 새벽 연말경계 전년 반환 방지. */
export function kstYear(date: Date): number {
  return Number(formatKstDateCompact(date).slice(0, 4));
}

/** KST 기준 월(1~12). 시스템 TZ 무관 — UTC 새벽 월경계 전월 반환 방지. */
export function kstMonth(date: Date): number {
  return Number(formatKstDateCompact(date).slice(4, 6));
}

/**
 * KST 기준 "오늘 00:00:00"의 절대 시각(UTC `Date`).
 *
 * 배경(DAR-243): 비용 한도 윈도 경계를 `Date.setHours(0,0,0,0)`(로컬 TZ)로 만들면
 * UTC 컨테이너에서 KST 자정이 아니라 UTC 자정으로 잡혀, Prisma가 UTC로 저장한
 * `createdAt`과 비교 시 일/월 경계가 9시간 어긋나 한도 윈도를 오산정한다.
 * Asia/Seoul은 DST가 없어 항상 +09:00이므로, KST 벽시계 날짜에 고정 오프셋을
 * 붙인 ISO 리터럴로 그 KST 자정의 절대 시각(UTC)을 안전하게 환산한다.
 */
export function kstDayStart(date: Date): Date {
  return new Date(`${formatKstDateDashed(date)}T00:00:00+09:00`);
}

/**
 * KST 기준 "이번 달 1일 00:00:00"의 절대 시각(UTC `Date`). 비용 한도 월윈도 경계.
 * `kstDayStart`와 동일 처방 — KST 벽시계 연·월에 +09:00을 붙여 UTC 절대 시각 환산.
 */
export function kstMonthStart(date: Date): Date {
  return new Date(`${formatKstDateDashed(date).slice(0, 7)}-01T00:00:00+09:00`);
}

/** KST 벽시계 요일(영문 약어)·분(0~1439) 추출용 — 시스템 TZ 무관(Intl). */
const KST_CLOCK = new Intl.DateTimeFormat('en-GB', {
  timeZone: KST_TIMEZONE,
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * KST 벽시계 요일·자정 기준 분(minute-of-day). 시스템 TZ 무관.
 * @returns weekday: 'Mon'..'Sun', minutes: 0~1439(=hour*60+minute)
 */
export function kstClock(date: Date): { weekday: string; minutes: number } {
  const p: Record<string, string> = {};
  for (const part of KST_CLOCK.formatToParts(date)) p[part.type] = part.value;
  return { weekday: p.weekday, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** KRX 정규장 시작·종료(KST 분). 09:00~15:30. */
export const KRX_REGULAR_OPEN_MIN = 9 * 60; // 540
export const KRX_REGULAR_CLOSE_MIN = 15 * 60 + 30; // 930

/**
 * KST 정규장 운영 시간대 여부 — 평일(월~금) 09:00~15:30(경계 포함).
 *
 * ★KRX 공휴일/임시휴장은 미반영(달력 데이터 비의존). 휴장일에는 KIS 실시간가 자체가 없어
 *   소비측(SimulationPriceSourceService)이 신선도로 자동 폴백한다 — 즉 휴장일 평가는 실시간이
 *   비어 손절이 '거짓 발화'하지 않는다(시장 닫힘 = 정직). 이 게이트의 목적은 장외 불필요 호출·
 *   로그 폭주 차단이며, 휴장 안전은 신선도 게이트가 이중으로 보장한다.
 */
export function isKstRegularMarketHours(date: Date): boolean {
  const { weekday, minutes } = kstClock(date);
  const isWeekday =
    weekday === 'Mon' || weekday === 'Tue' || weekday === 'Wed' ||
    weekday === 'Thu' || weekday === 'Fri';
  return isWeekday && minutes >= KRX_REGULAR_OPEN_MIN && minutes <= KRX_REGULAR_CLOSE_MIN;
}
