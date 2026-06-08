import { Injectable, Logger } from '@nestjs/common';

/**
 * RealtimeQuoteCache — 종목별 최신 실시간 현재가 인메모리 캐시 (DAR-140).
 *
 * KIS 폴러가 장중 분 단위로 set() 하고, 모의운용 평가(SimulationPriceSourceService)가
 * getFresh() 로 읽는다(단일 앱 프로세스의 싱글톤 공유 → 스키마/DB 변경 0).
 *
 * ★정직(불가침): 여기 가격은 '실제 시장 실시간가'(source=REALTIME). 신선도(maxAge)를 넘으면
 *   '실시간 없음'으로 간주해 소비측이 일봉/합성으로 폴백한다 — 오래된 값을 현재가로 오인 금지.
 *   환경 시계(2026)와 실제 현재 시각 괴리는 fetchedAtMs(실 wall-clock)로 드러난다.
 *
 * AI 금지영역: 단순 캐시(Rule). 체결·주문수량·하드룰과 무관.
 */

export interface RealtimeQuote {
  /** 캐시 키 — 모의 평가가 corpCode 로 조회한다(Company.corpCode FK 루트). */
  corpCode: string;
  stockCode: string;
  /** 현재가(체결가, 원). */
  price: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  /** 폴링 시점 실제 wall-clock(epoch ms) — 신선도 판정·정직 고지용. */
  fetchedAtMs: number;
}

/** 실시간 신선도 기본 임계(ms) — 5분. 이보다 오래되면 '실시간 없음' 처리(폴백). */
export const DEFAULT_REALTIME_MAX_AGE_MS = 5 * 60_000;

@Injectable()
export class RealtimeQuoteCache {
  private readonly logger = new Logger(RealtimeQuoteCache.name);
  private readonly quotes = new Map<string, RealtimeQuote>();

  /** 종목 최신 실시간 현재가 적재(폴러 호출). 동일 종목(corpCode)은 최신값으로 덮어쓴다. */
  set(quote: RealtimeQuote): void {
    this.quotes.set(quote.corpCode, quote);
  }

  /**
   * 신선한 실시간 현재가만 반환(corpCode 키). 없거나 maxAge 초과면 null(소비측은 일봉/합성 폴백).
   * @param nowMs 현재 epoch ms(테스트 주입 가능). 미지정 시 Date.now().
   */
  getFresh(
    corpCode: string,
    nowMs: number = Date.now(),
    maxAgeMs: number = DEFAULT_REALTIME_MAX_AGE_MS,
  ): RealtimeQuote | null {
    const q = this.quotes.get(corpCode);
    if (!q) return null;
    if (nowMs - q.fetchedAtMs > maxAgeMs) return null; // stale → 실시간 없음
    return q;
  }

  /** 진단/운영: 현재 캐시된 종목 수. */
  size(): number {
    return this.quotes.size;
  }

  /** 테스트/운영 리셋. */
  clear(): void {
    this.quotes.clear();
  }
}
