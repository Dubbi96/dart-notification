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
}
