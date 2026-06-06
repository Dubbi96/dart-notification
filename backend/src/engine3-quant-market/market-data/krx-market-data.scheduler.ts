import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { KrxApiService, KrxApiUnavailableError } from './krx-api.service';
import type { Prisma } from '@prisma/client';

/**
 * KRX 시세 일괄 수집 Cron 스케줄러.
 * 장 마감 후 EOD 배치 — StockDailyPrice + MarketIndex + 종목상태 수집.
 * DART SchedulerService와 동일 패턴 (isCollecting 락, 로그 기록).
 *
 * Cron 시간표:
 *   - 18:30 평일 — 일봉(StockDailyPrice) 수집
 *   - 18:45 평일 — 시장지수(MarketIndex) 수집
 *   - 08:50 평일 — 종목상태 갱신(장 시작 전)
 */
@Injectable()
export class KrxMarketDataScheduler {
  private readonly logger = new Logger(KrxMarketDataScheduler.name);
  private isDailyCollecting = false;
  private isIndexCollecting = false;
  private isStatusCollecting = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly krx: KrxApiService,
  ) {}

  /** 평일 18:30 — 일봉 수집 */
  @Cron('30 18 * * 1-5')
  async collectDailyPrices(): Promise<{ saved: number; skipped: number; message?: string }> {
    return this.collectDailyPricesForDate(this.krx.formatDate(new Date()), 'CRON');
  }

  /**
   * 날짜 지정 일봉 수집 (수동/백필용).
   * KRX API 미설정 시 graceful 리턴.
   */
  async collectDailyPricesForDate(
    basDd: string,
    triggeredBy: 'CRON' | 'MANUAL' = 'MANUAL',
  ): Promise<{ saved: number; skipped: number; message?: string }> {
    if (this.isDailyCollecting) {
      this.logger.warn('[KRX] 일봉 수집이 이미 진행 중입니다.');
      return { saved: 0, skipped: 0, message: '이전 작업 진행 중' };
    }

    const date = this.krx.parseDate(basDd);
    if (this.krx.isWeekend(date)) {
      this.logger.debug(`[KRX] ${basDd} 주말 — 일봉 수집 스킵`);
      return { saved: 0, skipped: 0, message: '주말 스킵' };
    }

    this.isDailyCollecting = true;
    let saved = 0;
    let skipped = 0;

    try {
      this.logger.log(`[KRX] 일봉 수집 시작 basDd=${basDd} [${triggeredBy}]`);

      // stockCode → corpCode 매핑 (DB 1회 조회)
      const companies = await this.prisma.company.findMany({
        where: { stockCode: { not: null } },
        select: { corpCode: true, stockCode: true },
      });
      const corpCodeByStockCode = new Map<string, string>(
        companies
          .filter((c): c is { corpCode: string; stockCode: string } => c.stockCode !== null)
          .map((c) => [c.stockCode, c.corpCode]),
      );

      // KOSPI + KOSDAQ 전종목 일봉 2회 호출 (종목당 N회 → 시장당 1회)
      const [kospiRows, kosdaqRows] = await Promise.all([
        this.krx.fetchStockDaily(basDd),
        this.krx.fetchKosqdaqDaily(basDd),
      ]);
      const allRows = [...kospiRows, ...kosdaqRows];

      for (const row of allRows) {
        if (!row.stockCode || row.closePrice === 0) {
          skipped++;
          continue;
        }
        const corpCode = corpCodeByStockCode.get(row.stockCode);
        if (!corpCode) {
          skipped++;
          continue;
        }

        await this.prisma.stockDailyPrice.upsert({
          where: {
            stockCode_tradeDate: { stockCode: row.stockCode, tradeDate: basDd },
          },
          create: {
            corpCode,
            stockCode: row.stockCode,
            tradeDate: basDd,
            openPrice: row.openPrice,
            highPrice: row.highPrice,
            lowPrice: row.lowPrice,
            closePrice: row.closePrice,
            volume: BigInt(row.volume),
            tradingValue: BigInt(row.tradingValue),
          },
          update: {
            openPrice: row.openPrice,
            highPrice: row.highPrice,
            lowPrice: row.lowPrice,
            closePrice: row.closePrice,
            volume: BigInt(row.volume),
            tradingValue: BigInt(row.tradingValue),
          },
        });
        saved++;
      }

      this.logger.log(`[KRX] 일봉 수집 완료 saved=${saved} skipped=${skipped}`);
      return { saved, skipped };
    } catch (e) {
      if (e instanceof KrxApiUnavailableError) {
        this.logger.warn(`[KRX] API 키 미설정 — 일봉 수집 스킵: ${(e as Error).message}`);
        return { saved: 0, skipped: 0, message: 'KRX API 미설정' };
      }
      this.logger.error(`[KRX] 일봉 수집 오류: ${(e as Error).message}`);
      return { saved, skipped, message: (e as Error).message };
    } finally {
      this.isDailyCollecting = false;
    }
  }

  /** 평일 18:45 — 시장지수 수집 */
  @Cron('45 18 * * 1-5')
  async collectMarketIndices(): Promise<{ saved: number; message?: string }> {
    return this.collectMarketIndicesForDate(this.krx.formatDate(new Date()), 'CRON');
  }

  async collectMarketIndicesForDate(
    basDd: string,
    triggeredBy: 'CRON' | 'MANUAL' = 'MANUAL',
  ): Promise<{ saved: number; message?: string }> {
    if (this.isIndexCollecting) {
      return { saved: 0, message: '이전 작업 진행 중' };
    }

    const date = this.krx.parseDate(basDd);
    if (this.krx.isWeekend(date)) {
      return { saved: 0, message: '주말 스킵' };
    }

    this.isIndexCollecting = true;
    let saved = 0;

    try {
      this.logger.log(`[KRX] 지수 수집 시작 basDd=${basDd} [${triggeredBy}]`);

      for (const indexType of ['KOSPI', 'KOSDAQ'] as const) {
        const rows = await this.krx.fetchIndexDaily(indexType, basDd);

        for (const row of rows) {
          if (row.closeIndex === 0) continue;

          await this.prisma.marketIndex.upsert({
            where: {
              indexCode_tradeDate: { indexCode: row.indexCode, tradeDate: basDd },
            },
            create: {
              indexCode: row.indexCode,
              indexName: row.indexName,
              tradeDate: basDd,
              openIndex: row.openIndex,
              highIndex: row.highIndex,
              lowIndex: row.lowIndex,
              closeIndex: row.closeIndex,
              volume: row.volume ? BigInt(row.volume) : null,
              tradingValue: row.tradingValue ? BigInt(row.tradingValue) : null,
            },
            update: {
              openIndex: row.openIndex,
              highIndex: row.highIndex,
              lowIndex: row.lowIndex,
              closeIndex: row.closeIndex,
              volume: row.volume ? BigInt(row.volume) : null,
              tradingValue: row.tradingValue ? BigInt(row.tradingValue) : null,
            },
          });
          saved++;
        }
      }

      this.logger.log(`[KRX] 지수 수집 완료 saved=${saved}`);
      return { saved };
    } catch (e) {
      if (e instanceof KrxApiUnavailableError) {
        this.logger.warn(`[KRX] API 키 미설정 — 지수 수집 스킵`);
        return { saved: 0, message: 'KRX API 미설정' };
      }
      this.logger.error(`[KRX] 지수 수집 오류: ${(e as Error).message}`);
      return { saved, message: (e as Error).message };
    } finally {
      this.isIndexCollecting = false;
    }
  }

  /** 평일 08:50 — 종목상태 수집 (장 시작 전) */
  @Cron('50 8 * * 1-5')
  async collectStockStatuses(): Promise<{ processed: number; message?: string }> {
    return this.collectStockStatusesForDate(this.krx.formatDate(new Date()), 'CRON');
  }

  async collectStockStatusesForDate(
    basDd: string,
    triggeredBy: 'CRON' | 'MANUAL' = 'MANUAL',
  ): Promise<{ processed: number; message?: string }> {
    if (this.isStatusCollecting) {
      return { processed: 0, message: '이전 작업 진행 중' };
    }

    const date = this.krx.parseDate(basDd);
    if (this.krx.isWeekend(date)) {
      return { processed: 0, message: '주말 스킵' };
    }

    this.isStatusCollecting = true;
    let processed = 0;

    try {
      this.logger.log(`[KRX] 종목상태 수집 basDd=${basDd} [${triggeredBy}]`);

      const statuses = await this.krx.fetchStockStatus(basDd);

      for (const s of statuses) {
        if (!s.stockCode) continue;

        await this.prisma.stockStatus.upsert({
          where: { stockCode: s.stockCode },
          create: {
            stockCode: s.stockCode,
            tradeDate: basDd,
            isTradingSuspended: s.isHalted,
            isManagement: s.isManagement,
            isInvestmentCaution: s.isWarning,
            isAbnormalSurge: s.isSurge,
          },
          update: {
            tradeDate: basDd,
            isTradingSuspended: s.isHalted,
            isManagement: s.isManagement,
            isInvestmentCaution: s.isWarning,
            isAbnormalSurge: s.isSurge,
          },
        });
        processed++;
      }

      this.logger.log(`[KRX] 종목상태 수집 완료 processed=${processed}`);
      return { processed };
    } catch (e) {
      if (e instanceof KrxApiUnavailableError) {
        this.logger.warn(`[KRX] API 키 미설정 — 종목상태 수집 스킵`);
        return { processed: 0, message: 'KRX API 미설정' };
      }
      this.logger.error(`[KRX] 종목상태 수집 오류: ${(e as Error).message}`);
      return { processed, message: (e as Error).message };
    } finally {
      this.isStatusCollecting = false;
    }
  }

  /**
   * 수집 이력 조회 (최근 20건)
   */
  async getCollectionLogs(tradeDate?: string) {
    return this.prisma.marketDataCollectionLog.findMany({
      where: tradeDate ? { tradeDate } : undefined,
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
  }

  /**
   * EOD 통합 수집 + 수집 로그 기록 (수동 트리거용)
   */
  async collectAll(
    basDd: string,
    triggeredBy: 'CRON' | 'MANUAL' = 'MANUAL',
  ): Promise<{ saved: number; skipped: number; indexSaved: number; statusProcessed: number }> {
    const log = await this.prisma.marketDataCollectionLog.create({
      data: { tradeDate: basDd, triggeredBy, status: 'RUNNING' },
    });

    let savedCount = 0;
    let skippedCount = 0;
    let indexSaved = 0;
    let statusProcessed = 0;

    try {
      const [priceResult, indexResult, statusResult] = await Promise.all([
        this.collectDailyPricesForDate(basDd, triggeredBy),
        this.collectMarketIndicesForDate(basDd, triggeredBy),
        this.collectStockStatusesForDate(basDd, triggeredBy),
      ]);

      savedCount = priceResult.saved;
      skippedCount = priceResult.skipped;
      indexSaved = indexResult.saved;
      statusProcessed = statusResult.processed;

      const companies = await this.prisma.company.count({
        where: { stockCode: { not: null } },
      });

      await this.prisma.marketDataCollectionLog.update({
        where: { id: log.id },
        data: {
          status: 'SUCCESS',
          stockCount: companies,
          savedCount,
          failedCount: skippedCount,
          indexSaved: indexSaved > 0,
          statusSaved: statusProcessed > 0,
          endedAt: new Date(),
        },
      });

      return { saved: savedCount, skipped: skippedCount, indexSaved, statusProcessed };
    } catch (e) {
      await this.prisma.marketDataCollectionLog.update({
        where: { id: log.id },
        data: {
          status: 'FAILED',
          savedCount,
          failedCount: skippedCount,
          errorMessage: (e as Error).message,
          endedAt: new Date(),
        },
      });
      throw e;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // DAR-50: 히스토리컬 일봉 백필
  // ─────────────────────────────────────────────────────────────────────────

  /** stockCode → corpCode 매핑 (DB 1회 로드) */
  private async loadCorpCodeMap(): Promise<Map<string, string>> {
    const companies = await this.prisma.company.findMany({
      where: { stockCode: { not: null } },
      select: { corpCode: true, stockCode: true },
    });
    return new Map(
      companies
        .filter((c): c is { corpCode: string; stockCode: string } => c.stockCode !== null)
        .map((c) => [c.stockCode, c.corpCode]),
    );
  }

  private dateRange(dates: string[]): { from: string | null; to: string | null } {
    if (dates.length === 0) return { from: null, to: null };
    const sorted = [...dates].sort();
    return { from: sorted[0], to: sorted[sorted.length - 1] };
  }

  /**
   * 단일 날짜 일봉 bulk 수집 (히스토리컬·멱등). createMany skipDuplicates 사용.
   * 히스토리컬 EOD 가격은 불변이므로 upsert 대신 bulk insert(중복 무시)로 처리 — 빠름.
   * @returns saved(신규 삽입행수)·skipped(매핑/0가 제외)·rowsFetched(KRX 원행수, 0이면 휴장)
   */
  async collectDailyPricesBulkForDate(
    basDd: string,
    corpCodeByStockCode?: Map<string, string>,
  ): Promise<{ saved: number; skipped: number; rowsFetched: number }> {
    const map = corpCodeByStockCode ?? (await this.loadCorpCodeMap());

    const [kospiRows, kosdaqRows] = await Promise.all([
      this.krx.fetchStockDaily(basDd),
      this.krx.fetchKosqdaqDaily(basDd),
    ]);
    const allRows = [...kospiRows, ...kosdaqRows];
    const rowsFetched = allRows.length;

    const data: Prisma.StockDailyPriceCreateManyInput[] = [];
    let skipped = 0;
    for (const row of allRows) {
      if (!row.stockCode || row.closePrice === 0) {
        skipped++;
        continue;
      }
      const corpCode = map.get(row.stockCode);
      if (!corpCode) {
        skipped++;
        continue;
      }
      data.push({
        corpCode,
        stockCode: row.stockCode,
        tradeDate: basDd,
        openPrice: row.openPrice,
        highPrice: row.highPrice,
        lowPrice: row.lowPrice,
        closePrice: row.closePrice,
        volume: BigInt(row.volume),
        tradingValue: BigInt(row.tradingValue),
      });
    }

    if (data.length === 0) return { saved: 0, skipped, rowsFetched };
    const result = await this.prisma.stockDailyPrice.createMany({
      data,
      skipDuplicates: true,
    });
    return { saved: result.count, skipped, rowsFetched };
  }

  /**
   * 히스토리컬 일봉 백필 (DAR-50).
   * endDate(기본 오늘)부터 거래일 기준 과거로 days개 거래일의 일봉을 수집한다.
   * - 주말 스킵 / 휴장일은 KRX 0행 반환 → 거래일로 카운트하지 않고 스킵(emptyDates 기록).
   * - 멱등: createMany skipDuplicates (이미 적재된 (stockCode, tradeDate) 는 무시).
   * - 레이트리밋 대응: 날짜 호출 간 delayMs 지연.
   * - graceful: KRX 미설정 시 즉시 리턴, 개별 날짜 오류는 emptyDates 처리 후 계속.
   */
  async backfillDailyPrices(
    opts: {
      days?: number;
      endDate?: string;
      delayMs?: number;
      maxLookbackDays?: number;
    } = {},
  ): Promise<{
    requestedDays: number;
    collectedDays: number;
    totalSaved: number;
    totalSkipped: number;
    emptyDates: string[];
    dateRange: { from: string | null; to: string | null };
    message?: string;
  }> {
    const days = opts.days ?? 60;
    const delayMs = opts.delayMs ?? 300;
    const maxLookback = opts.maxLookbackDays ?? days * 3 + 15;
    const endDate = opts.endDate ?? this.krx.formatDate(new Date());

    const corpCodeByStockCode = await this.loadCorpCodeMap();
    if (corpCodeByStockCode.size === 0) {
      return {
        requestedDays: days,
        collectedDays: 0,
        totalSaved: 0,
        totalSkipped: 0,
        emptyDates: [],
        dateRange: { from: null, to: null },
        message: '종목코드 보유 Company 없음',
      };
    }

    let collectedDays = 0;
    let totalSaved = 0;
    let totalSkipped = 0;
    const emptyDates: string[] = [];
    const collectedDates: string[] = [];

    const cursor = this.krx.parseDate(endDate);
    let lookback = 0;

    this.logger.log(`[KRX][백필] 시작 endDate=${endDate} days=${days} (maxLookback=${maxLookback})`);

    while (collectedDays < days && lookback < maxLookback) {
      const basDd = this.krx.formatDate(cursor);
      cursor.setDate(cursor.getDate() - 1);
      lookback++;

      if (this.krx.isWeekend(this.krx.parseDate(basDd))) continue;

      try {
        const res = await this.collectDailyPricesBulkForDate(basDd, corpCodeByStockCode);
        if (res.rowsFetched === 0) {
          emptyDates.push(basDd); // 휴장일 — 거래일 카운트 제외
          continue;
        }
        collectedDays++;
        collectedDates.push(basDd);
        totalSaved += res.saved;
        totalSkipped += res.skipped;
        this.logger.log(
          `[KRX][백필] ${basDd} saved=${res.saved} skipped=${res.skipped} (${collectedDays}/${days})`,
        );
      } catch (e) {
        if (e instanceof KrxApiUnavailableError) {
          this.logger.warn('[KRX][백필] API 키 미설정 — 백필 중단');
          return {
            requestedDays: days,
            collectedDays,
            totalSaved,
            totalSkipped,
            emptyDates,
            dateRange: this.dateRange(collectedDates),
            message: 'KRX API 미설정',
          };
        }
        this.logger.error(`[KRX][백필] ${basDd} 오류: ${(e as Error).message}`);
        emptyDates.push(basDd);
      }

      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }

    this.logger.log(
      `[KRX][백필] 완료 collectedDays=${collectedDays}/${days} totalSaved=${totalSaved} range=${JSON.stringify(this.dateRange(collectedDates))}`,
    );
    return {
      requestedDays: days,
      collectedDays,
      totalSaved,
      totalSkipped,
      emptyDates,
      dateRange: this.dateRange(collectedDates),
    };
  }
}
