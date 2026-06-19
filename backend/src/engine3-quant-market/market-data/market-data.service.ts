import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isImplausibleIndexChange } from './index-sanity';
import { KisApiService } from './kis-api.service';
import { formatKstDateCompact } from '../../common/time/kst';

export interface StockDailyPrice {
  stockCode: string;
  tradeDate: string;
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  volume: number;
  tradingValue?: number;
}

/**
 * 시장지수 최신값(전일대비 등락 포함) — GET /market-data/indices/latest 응답 단위 (DAR-160).
 * 데이터가 1건뿐이면 전일 기준이 없어 prevCloseIndex·change·changePercent 는 null.
 */
export interface MarketIndexQuote {
  indexCode: string; // 0001=KOSPI, 1001=KOSDAQ
  indexName: string;
  market: 'KOSPI' | 'KOSDAQ';
  tradeDate: string; // 최신 거래일 YYYYMMDD
  closeIndex: number; // 최신 종가지수
  prevCloseIndex: number | null; // 전일 종가지수 (없으면 null)
  change: number | null; // 전일대비 등락폭 (포인트)
  changePercent: number | null; // 전일대비 등락률 (%)
  // DAR-367: 인접 거래일 |Δ| 가 물리적으로 불가능한 수준(>±20%)이면 전일 종가가 오염된
  // 것으로 보고 등락 필드를 노출하지 않는다(null). suspect=true 면 배지가 '데이터 점검중'
  // 폴백을 띄울 수 있다. 정상 데이터에서는 false.
  suspect: boolean;
  // DAR-371: 가격 출처 — 'REALTIME'(KIS 실시간 지수) | 'EOD'(KRX 일봉 종가).
  // 신선도 정직: EOD 는 tradeDate 가 '종가 기준일'이므로 배지가 'YYYY-MM-DD 종가 기준' 라벨을
  // 띄워 stale 을 현재로 오인하지 않게 한다. REALTIME 은 '실시간' 라벨.
  source: 'REALTIME' | 'EOD';
  // REALTIME 일 때 서버가 KIS 를 조회한 시각(ISO). EOD 면 null(tradeDate 가 기준).
  asOf: string | null;
}

/**
 * 시세 조회 서비스 — Prisma DB에서 읽기 전용 조회 제공.
 * 수집은 KrxMarketDataScheduler가 담당 (EOD 배치).
 */
/** 시장지수 최신값 캐시 TTL(ms) — EOD 데이터라 분 단위 신선도면 충분(DAR-170). */
export const INDICES_CACHE_TTL_MS = 60_000;

@Injectable()
export class MarketDataService {
  private readonly logger = new Logger(MarketDataService.name);

  // 시장지수 최신값 in-memory 캐시(DAR-170) — 지수는 장 마감 후(EOD) 1회만 갱신되는데
  // 홈 진입마다 KOSPI·KOSDAQ 2회 DB 조회가 발생했다. 60s TTL 로 동일 결과 재조회를 흡수한다.
  private indicesCache: { expiresAtMs: number; data: MarketIndexQuote[] } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    // @Optional: KIS 미배선(테스트 등)·키 미설정 시 EOD 일봉 폴백으로 graceful 동작(DAR-371).
    @Optional() private readonly kisApi?: KisApiService,
  ) {}

  /**
   * 일봉 조회 (DB 읽기).
   * @param stockCode 종목코드 6자리
   * @param from 시작일 YYYYMMDD
   * @param to 종료일 YYYYMMDD
   */
  async fetchDailyPrice(stockCode: string, from: string, to: string): Promise<StockDailyPrice[]> {
    const rows = await this.prisma.stockDailyPrice.findMany({
      where: {
        stockCode,
        tradeDate: { gte: from, lte: to },
      },
      orderBy: { tradeDate: 'asc' },
    });

    return rows.map((r) => ({
      stockCode: r.stockCode,
      tradeDate: r.tradeDate,
      openPrice: r.openPrice,
      highPrice: r.highPrice,
      lowPrice: r.lowPrice,
      closePrice: r.closePrice,
      volume: Number(r.volume),
      tradingValue: r.tradingValue ? Number(r.tradingValue) : undefined,
    }));
  }

  /**
   * 현재가 조회 — 최신 일봉 종가 반환.
   * 실시간 현재가는 Phase 6 KIS OpenAPI 보완 시 추가.
   */
  async fetchCurrentPrice(stockCode: string): Promise<number> {
    const latest = await this.prisma.stockDailyPrice.findFirst({
      where: { stockCode },
      orderBy: { tradeDate: 'desc' },
      select: { closePrice: true },
    });
    return latest?.closePrice ?? 0;
  }

  /** 시장지수 일봉 조회 */
  async fetchMarketIndex(
    indexCode: string,
    from: string,
    to: string,
  ): Promise<Array<{ indexCode: string; tradeDate: string; closeIndex: number }>> {
    const rows = await this.prisma.marketIndex.findMany({
      where: {
        indexCode,
        tradeDate: { gte: from, lte: to },
      },
      orderBy: { tradeDate: 'asc' },
    });

    return rows.map((r) => ({
      indexCode: r.indexCode,
      tradeDate: r.tradeDate,
      closeIndex: r.closeIndex,
    }));
  }

  /** 종목 상태 조회 (거래정지·관리종목·투자주의 등) */
  async getStockStatus(stockCode: string) {
    return this.prisma.stockStatus.findUnique({ where: { stockCode } });
  }

  // KOSPI·KOSDAQ 지수코드 매핑 (krx-api.service 의 fetchIndexDaily 와 동일).
  private static readonly MARKET_INDEX_CODES: ReadonlyArray<{
    code: string;
    market: 'KOSPI' | 'KOSDAQ';
  }> = [
    { code: '0001', market: 'KOSPI' },
    { code: '1001', market: 'KOSDAQ' },
  ];

  /**
   * 시장지수 최신값 조회 (DAR-160) — KOSPI·KOSDAQ 각각 최신 종가 + 전일대비 등락률.
   * 지수별로 최근 2거래일(desc)을 읽어 최신/전일을 산출한다. 데이터가 없는 지수는 결과에서
   * 생략하고, 1건뿐이면 등락 필드를 null 로 둔다(홈 배지가 깨지지 않도록 graceful).
   *
   * EOD 데이터이므로 60s in-memory TTL 캐시(DAR-170)로 홈 진입마다의 반복 DB 조회를 흡수한다.
   * @param nowMs 캐시 신선도 판정용 현재 epoch ms(테스트 주입 가능).
   */
  async fetchLatestIndices(nowMs: number = Date.now()): Promise<MarketIndexQuote[]> {
    if (this.indicesCache && nowMs < this.indicesCache.expiresAtMs) {
      return this.indicesCache.data;
    }

    const results: MarketIndexQuote[] = [];

    for (const { code, market } of MarketDataService.MARKET_INDEX_CODES) {
      // DAR-371 ①현재 지수 소스 우선: KIS 실시간 업종지수가 가용하면 그 실가로 배지를 구동한다
      // (주식 실시간가와 동일 정신·source=REALTIME). 실패/미설정/미배선이면 ②EOD 일봉 폴백.
      const realtime = await this.tryFetchRealtimeIndex(code, market, nowMs);
      if (realtime) {
        results.push(realtime);
        continue;
      }

      const rows = await this.prisma.marketIndex.findMany({
        where: { indexCode: code },
        orderBy: { tradeDate: 'desc' },
        take: 2,
        select: { indexCode: true, indexName: true, tradeDate: true, closeIndex: true },
      });

      if (rows.length === 0) continue; // 미적재 지수는 생략 (배지 측에서 부분 표시).

      const latest = rows[0];
      const prevClose = rows.length > 1 ? rows[1].closeIndex : null;

      // DAR-367 표시 단계 방어선: 적재 가드가 들어오기 전 과거에 오염된 행(예: 8639.41)이
      // 전일 종가로 남아 있으면 -63.75% 같은 불가능한 등락률이 산출된다. 이를 사용자에게
      // 노출하지 않도록 등락 필드를 모두 숨기고(suspect=true) 최신 종가만 표시한다.
      const suspect = isImplausibleIndexChange(latest.closeIndex, prevClose);
      if (suspect) {
        this.logger.warn(
          `[지수] ${market} 등락률 이상치 감지 — close=${latest.closeIndex}(${latest.tradeDate}) ` +
            `prevClose=${prevClose} → 등락 미표시(데이터 점검 필요)`,
        );
      }

      const change =
        !suspect && prevClose !== null ? round2(latest.closeIndex - prevClose) : null;
      const changePercent =
        !suspect && prevClose !== null && prevClose !== 0
          ? round2(((latest.closeIndex - prevClose) / prevClose) * 100)
          : null;

      results.push({
        indexCode: latest.indexCode,
        indexName: latest.indexName,
        market,
        tradeDate: latest.tradeDate,
        closeIndex: latest.closeIndex,
        prevCloseIndex: suspect ? null : prevClose,
        change,
        changePercent,
        suspect,
        source: 'EOD',
        asOf: null,
      });
    }

    this.indicesCache = {
      expiresAtMs: nowMs + INDICES_CACHE_TTL_MS,
      data: results,
    };
    return results;
  }

  /**
   * KIS 실시간 업종지수 시도 (DAR-371). 키 미설정·미배선·응답 결측·이상치면 null → EOD 폴백.
   *
   * ±20% sanity 가드(DAR-367) 유지: 실시간 등락률이 물리적으로 불가능하면(데이터 오류 의심)
   * 등락은 숨기되(suspect=true) 현재 지수는 표시한다. tradeDate 는 KST 조회 당일.
   * @param nowMs 토큰 만료 판정·asOf 산출용 현재 epoch ms.
   */
  private async tryFetchRealtimeIndex(
    code: string,
    market: 'KOSPI' | 'KOSDAQ',
    nowMs: number,
  ): Promise<MarketIndexQuote | null> {
    if (!this.kisApi || !this.kisApi.isConfigured) return null;
    try {
      const live = await this.kisApi.fetchIndexPrice(code, nowMs);
      if (!live || live.price <= 0) return null;

      const prevClose = live.prevClose > 0 ? live.prevClose : null;
      const suspect = isImplausibleIndexChange(live.price, prevClose);
      if (suspect) {
        this.logger.warn(
          `[지수] ${market} KIS 실시간 등락률 이상치 — price=${live.price} ` +
            `prevClose=${prevClose} → 등락 미표시(데이터 점검 필요)`,
        );
      }
      return {
        indexCode: code,
        indexName: market,
        market,
        tradeDate: formatKstDateCompact(new Date(nowMs)),
        closeIndex: live.price,
        prevCloseIndex: suspect ? null : prevClose,
        change: suspect ? null : live.change,
        changePercent: suspect ? null : live.changePercent,
        suspect,
        source: 'REALTIME',
        asOf: new Date(nowMs).toISOString(),
      };
    } catch (e) {
      // 키 미설정 예외(KisApiUnavailableError) 포함 모든 실패를 흡수 → EOD 폴백으로 graceful.
      this.logger.warn(`[지수] ${market} KIS 실시간 조회 실패: ${(e as Error).message}`);
      return null;
    }
  }
}

/** 소수 2자리 반올림 (등락폭·등락률 표시용). */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
