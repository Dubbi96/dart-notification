import { Injectable } from '@nestjs/common';

/** 장마감 시각 (KST 15:30) */
const MARKET_CLOSE_HOUR = 15;
const MARKET_CLOSE_MINUTE = 30;

/** KST 오프셋 (UTC+9, 한국은 DST 없음) */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 임의 시각을 KST 벽시계로 환산한 Date.
 * 반환 Date의 getUTC* 메서드가 KST의 연/월/일/시/분을 그대로 돌려준다.
 * 이를 통해 시스템 로컬 TZ에 의존하는 getHours/getMinutes/getDate 류를 배제한다.
 * (예: 2024-01-08T15:30:00+09:00 → getUTCHours()=15, getUTCMinutes()=30)
 */
function toKst(date: Date): Date {
  return new Date(date.getTime() + KST_OFFSET_MS);
}

/**
 * 거래일 계산 및 장중/장후 판정 서비스
 * lookahead bias 방지의 핵심: 공시 시각 기준으로 "진입 가능한 최초 거래일"을 결정한다.
 * - 장중 공시 (≤15:30): 당일이 다음 거래일 (진입 = 다음 거래일 시가)
 * - 장후 공시 (>15:30): 다음 거래일이 진입일
 * 규칙: 공시 당일 종가 진입 절대 금지
 *
 * 모든 시각 판정은 KST(UTC+9) 명시 계산으로 수행한다. 시스템 로컬 TZ에 의존하면
 * UTC 서버(프로덕션·CI)에서 9시간 오판(15:30 KST=06:30 UTC)이 발생한다.
 */
@Injectable()
export class MarketCalendarService {
  /** 공시 시각이 장마감(15:30 KST) 이후인지 판정 (시스템 TZ 무관) */
  isAfterMarket(disclosureAt: Date): boolean {
    const kst = toKst(disclosureAt);
    const hour = kst.getUTCHours();
    const minute = kst.getUTCMinutes();
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

  /** YYYY-MM-DD(KST 거래일) 파싱 → 해당 KST 날짜의 UTC 자정 Date (정준 표현) */
  parseDate(dateStr: string): Date {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  /**
   * Date → YYYY-MM-DD (KST 거래일 기준).
   * 실제 공시 timestamp(예: 자정~09시 KST 구간은 UTC 전일)도 KST 날짜로 올바르게 환산한다.
   * parseDate 산출물(UTC 자정)은 +9h 적용 후에도 같은 날짜로 왕복(roundtrip)된다.
   */
  formatDate(date: Date): string {
    const kst = toKst(date);
    const y = kst.getUTCFullYear();
    const m = String(kst.getUTCMonth() + 1).padStart(2, '0');
    const d = String(kst.getUTCDate()).padStart(2, '0');
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
