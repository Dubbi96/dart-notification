/**
 * d0-calculator.ts — D0 날짜 결정 로직 (M5-A, DAR-9)
 *
 * KRX 거래일 기준:
 * - 월~금 (공휴일 제외)
 * - 장 마감 기준: 15:20 이전 접수 → 당일 D0
 *                 15:20 이후 또는 날짜만 알 경우 → 보수적으로 다음 거래일
 *
 * ★DAR-481: 거래일·휴장일 판정을 단일 SSOT(common/time/market-calendar)로 수렴.
 *   기존 로컬 KNOWN_HOLIDAYS(2026 5건뿐 — 하반기 공휴일 누락)를 제거하고 위임한다.
 *   isKRXTradingDay/nextTradingDay 는 SSOT 재노출(하위호환). 2026 공휴일 보강 효과가
 *   EventStudy D0 산정에 반영된다(하반기 공휴일을 거래일로 오인하던 시한성 버그 해소).
 */
import {
  isTradingDay as calendarIsTradingDay,
  nextTradingDay as calendarNextTradingDay,
} from '../../../common/time/market-calendar';

/**
 * 해당 날짜가 KRX 거래일인지 확인 — 월~금 && 공휴일 아님.
 * (SSOT: market-calendar.isTradingDay 위임. 하위호환 재노출.)
 */
export function isKRXTradingDay(date: string): boolean {
  return calendarIsTradingDay(date);
}

/**
 * date 이후 첫 번째 KRX 거래일 (date 자신이 거래일이어도 다음 거래일 반환).
 * (SSOT: market-calendar.nextTradingDay 위임. 하위호환 재노출.)
 */
export function nextTradingDay(date: string): string {
  return calendarNextTradingDay(date);
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
