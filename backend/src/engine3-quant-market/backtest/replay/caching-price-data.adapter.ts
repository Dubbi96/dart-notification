import { Logger } from '@nestjs/common';
import { DailyPrice } from '../ports/backtest.types';
import { PriceDataPort } from '../ports/price-data.port';
import { AssetClass, DEFAULT_ASSET_CLASS } from '../../../common/asset/asset-class';

/**
 * CachingBacktestPriceAdapter — 확장 검증 창(11년) 러너 완주용 가격 조회 캐시 어댑터 (DAR-544).
 *
 * 문제: BacktestRunnerService 는 매 거래일·매 포지션마다 getDailyPrices(stock, day, day) 를
 *   호출한다. 11년(≈2,700 거래일) 창에서는 종목당 O(거래일) 회의 DB 왕복이 발생해 러너가
 *   현실적으로 완주하기 어렵다(성능 병목 — 메모리가 아닌 질의 팬아웃).
 *
 * 해법: 각 종목의 창 [windowStart, windowEnd] 전체 일봉을 최초 접근 시 1회만 내부 어댑터로
 *   적재해 캐시하고, 이후 [s,e] 조회는 메모리에서 슬라이스한다. 종목당 질의 O(거래일) → O(1).
 *   메모리는 '접근한 종목 × 창 일수'로 유한하며, 청크(연 단위) 실행 시 청크마다 새 어댑터를
 *   써 종목별 캐시를 청크 창(≈245행)으로 제한한다.
 *
 * ★ 결과 불변(불가침): 내부 어댑터가 반환하는 것과 동일한 행을 동일 순서로 슬라이스만 한다.
 *   asOf 상한·거래정지/관리종목 일별 플래그도 내부 어댑터가 창 적재 시 그대로 채운다 →
 *   러너 산출(트레이드·성과)이 캐시 유무와 무관하게 동일하다(성능 최적화, 측정값 무변경).
 *
 * ★ read-only — 순수 조회 캐시. 어떤 쓰기도 없다. AI 개입 0.
 */
export class CachingBacktestPriceAdapter extends PriceDataPort {
  private readonly logger = new Logger(CachingBacktestPriceAdapter.name);
  /** `${assetClass}:${stockCode}` → 창 전체 일봉(오름차순). 동시 호출 dedupe 위해 Promise 보관. */
  private readonly cache = new Map<string, Promise<DailyPrice[]>>();
  private hits = 0;
  private loads = 0;

  /**
   * @param inner       실제 데이터 소스(PrismaBacktestPriceAdapter 등). asOf 는 inner 가 강제.
   * @param windowStart 캐시 대상 창 시작 YYYY-MM-DD(포함).
   * @param windowEnd   캐시 대상 창 종료 YYYY-MM-DD(포함).
   */
  constructor(
    private readonly inner: PriceDataPort,
    private readonly windowStart: string,
    private readonly windowEnd: string,
  ) {
    super();
  }

  private async loadWindow(stockCode: string, assetClass: AssetClass): Promise<DailyPrice[]> {
    const key = `${assetClass}:${stockCode}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.hits += 1;
      return cached;
    }
    this.loads += 1;
    const promise = this.inner.getDailyPrices(
      stockCode,
      this.windowStart,
      this.windowEnd,
      assetClass,
    );
    this.cache.set(key, promise);
    return promise;
  }

  async getDailyPrices(
    stockCode: string,
    startDate: string,
    endDate: string,
    assetClass: AssetClass = DEFAULT_ASSET_CLASS,
  ): Promise<DailyPrice[]> {
    // 창 밖 조회는 방어적으로 내부에 직접 위임(캐시가 잘못된 절단본을 반환하지 않도록).
    if (startDate < this.windowStart || endDate > this.windowEnd) {
      return this.inner.getDailyPrices(stockCode, startDate, endDate, assetClass);
    }
    const window = await this.loadWindow(stockCode, assetClass);
    return window.filter((p) => p.date >= startDate && p.date <= endDate);
  }

  async getOpenPrice(
    stockCode: string,
    date: string,
    assetClass: AssetClass = DEFAULT_ASSET_CLASS,
  ): Promise<number | null> {
    if (date < this.windowStart || date > this.windowEnd) {
      return this.inner.getOpenPrice(stockCode, date, assetClass);
    }
    const window = await this.loadWindow(stockCode, assetClass);
    return window.find((p) => p.date === date)?.open ?? null;
  }

  async getTradingDays(
    startDate: string,
    endDate: string,
    assetClass: AssetClass = DEFAULT_ASSET_CLASS,
  ): Promise<string[]> {
    // 거래일 목록은 전 유니버스 대상(종목별 캐시로 유도 불가) → 내부에 위임(단일 groupBy, 저렴).
    return this.inner.getTradingDays(startDate, endDate, assetClass);
  }

  /** 캐시 효율 관측용(로그/리포트). 러너 산출에는 영향 없음. */
  stats(): { loads: number; hits: number; cachedStocks: number } {
    return { loads: this.loads, hits: this.hits, cachedStocks: this.cache.size };
  }
}
