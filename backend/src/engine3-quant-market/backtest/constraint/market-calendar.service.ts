import { Injectable } from '@nestjs/common';

/** 장마감 시각 (KST 15:30) */
const MARKET_CLOSE_HOUR = 15;
const MARKET_CLOSE_MINUTE = 30;

/**
 * 거래일 계산 및 장중/장후 판정 서비스
 * lookahead bias 방지의 핵심: 공시 시각 기준으로 "진입 가능한 최초 거래일"을 결정한다.
 * - 장중 공시 (≤15:30): 당일이 다음 거래일 (진입 = 다음 거래일 시가)
 * - 장후 공시 (>15:30): 다음 거래일이 진입일
 * 규칙: 공시 당일 종가 진입 절대 금지
 */
@Injectable()
export class MarketCalendarService {
  /** 공시 시각이 장마감(15:30) 이후인지 판정 */
  isAfterMarket(disclosureAt: Date): boolean {
    const hour = disclosureAt.getHours();
    const minute = disclosureAt.getMinutes();
    if (hour > MARKET_CLOSE_HOUR) return true;
    if (hour === MARKET_CLOSE_HOUR && minute >= MARKET_CLOSE_MINUTE) return true;
    return false;
  }

  /**
   * 진입 거래일 결정
   * 공시 당일 시각에 관계없이 항상 "다음 거래일 시가"로 진입.
   * 장중 공시라도 당일 종가 진입은 lookahead bias이므로 금지.
   * @param disclosureDate YYYY-MM-DD 형태의 공시일
   * @param tradingDays 전체 거래일 목록 (정렬됨)
   */
  getEntryDate(disclosureDate: string, tradingDays: string[]): string | null {
    const idx = tradingDays.indexOf(disclosureDate);
    if (idx === -1) {
      // 공시일이 휴장일인 경우 — 이후 첫 거래일의 다음 거래일
      const nextTrading = tradingDays.find((d) => d > disclosureDate);
      if (!nextTrading) return null;
      const nextIdx = tradingDays.indexOf(nextTrading);
      return tradingDays[nextIdx + 1] ?? null;
    }
    // 공시일 다음 거래일 시가 진입
    return tradingDays[idx + 1] ?? null;
  }

  /** YYYY-MM-DD 파싱 (UTC 기준 — 타임존 편차 방지) */
  parseDate(dateStr: string): Date {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  /** Date → YYYY-MM-DD (UTC 기준) */
  formatDate(date: Date): string {
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /** 두 날짜 사이 일수 */
  daysBetween(from: string, to: string): number {
    const a = this.parseDate(from);
    const b = this.parseDate(to);
    return Math.round((b.getTime() - a.getTime()) / 86400000);
  }

  /** YYYY-MM 형태의 월 키 */
  toMonthKey(dateStr: string): string {
    return dateStr.substring(0, 7);
  }
}
