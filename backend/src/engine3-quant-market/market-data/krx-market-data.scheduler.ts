import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { KrxApiService, KrxApiUnavailableError } from './krx-api.service';
import { DartStockStatusService, DerivedStockStatus } from './dart-stock-status.service';
import type { Prisma } from '@prisma/client';
import { KST_TIMEZONE } from '../../common/time/kst';

/**
 * KRX 시세 일괄 수집 Cron 스케줄러.
 * 장 마감 후 EOD 배치 — StockDailyPrice + MarketIndex + 종목상태 수집.
 * DART SchedulerService와 동일 패턴 (isCollecting 락, 로그 기록).
 *
 * Cron 시간표:
 *   - 18:30 평일 — 일봉(StockDailyPrice) 수집
 *   - 18:45 평일 — 시장지수(MarketIndex) 수집
 *   - 08:50 평일 — 종목상태 갱신(장 시작 전)
 *   - 08:40 월요일 — 시장분류(company.market KOSPI/KOSDAQ) 동기화 (DAR-328)
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
    private readonly dartStockStatus: DartStockStatusService,
  ) {}

  /** 평일 18:30(KST) — 일봉 수집 */
  @Cron('30 18 * * 1-5', { timeZone: KST_TIMEZONE })
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

      // DAR-234: 백필 경로(collectDailyPricesBulkForDate)와 동일한 createMany 단일 적재로 통일.
      // createMany 는 단일 INSERT … ON CONFLICT DO NOTHING 으로 전종목을 원자적으로 적재 —
      // 행당 순차 upsert 의 부분커밋(중간 실패 시 일부 종목만 적재) 위험을 제거하고,
      // 다운스트림(signal-generation 19:00 · paper-simulation 19:30)이 부분 데이터로 도는 창을 닫는다.
      // EOD 종가는 마감 후 불변이므로 skipDuplicates(이미 적재된 (stockCode, tradeDate) 무시)가
      // 멱등 — 중단 후 재실행해도 무손상(누락 행만 신규 삽입).
      const corpCodeByStockCode = await this.loadCorpCodeMap();
      const result = await this.collectDailyPricesBulkForDate(basDd, corpCodeByStockCode);
      saved = result.saved;
      skipped = result.skipped;

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

  /** 평일 18:45(KST) — 시장지수 수집 */
  @Cron('45 18 * * 1-5', { timeZone: KST_TIMEZONE })
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

  /**
   * 월요일 08:40(KST) — 시장분류(company.market) 동기화 (DAR-328).
   * 시장구분은 거의 변하지 않으므로 주 1회로 충분(상장/이전상장 반영). 멱등.
   */
  @Cron('40 8 * * 1', { timeZone: KST_TIMEZONE })
  async syncCompanyMarketsCron(): Promise<{
    scanned: number;
    updated: number;
    unmatched: number;
    message?: string;
  }> {
    return this.syncCompanyMarkets(this.krx.formatDate(new Date()), 'CRON');
  }

  /** 평일 08:50(KST) — 종목상태 수집 (장 시작 전) */
  @Cron('50 8 * * 1-5', { timeZone: KST_TIMEZONE })
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

      // DAR-69: KRX 승인 전까지 관리종목·거래정지는 DART 공시 폴백으로 도출.
      // KRX 실응답(stk/ksq_isu_base_info)은 거래정지/관리종목 필드가 아직 미매핑
      // (krx-api.service TODO) 이므로 폴백 플래그를 OR 병합한다.
      const dartByStockCode = await this.buildDartStatusByStockCode();

      const statuses = await this.krx.fetchStockStatus(basDd);

      for (const s of statuses) {
        if (!s.stockCode) continue;

        const dart = dartByStockCode.get(s.stockCode);
        const isTradingSuspended = s.isHalted || (dart?.isHalted ?? false);
        const isManagement = s.isManagement || (dart?.isManagement ?? false);
        const statusNote = dart?.statusNote ?? null;

        await this.prisma.stockStatus.upsert({
          where: { stockCode: s.stockCode },
          create: {
            stockCode: s.stockCode,
            tradeDate: basDd,
            isTradingSuspended,
            isManagement,
            isInvestmentCaution: s.isWarning,
            isAbnormalSurge: s.isSurge,
            statusNote,
          },
          update: {
            tradeDate: basDd,
            isTradingSuspended,
            isManagement,
            isInvestmentCaution: s.isWarning,
            isAbnormalSurge: s.isSurge,
            statusNote,
          },
        });
        processed++;
      }

      this.logger.log(`[KRX] 종목상태 수집 완료 processed=${processed}`);
      return { processed };
    } catch (e) {
      if (e instanceof KrxApiUnavailableError) {
        // KRX 미설정 — DART 공시 폴백만으로 상태 적재 (DAR-69).
        this.logger.warn(`[KRX] API 키 미설정 — DART 공시 폴백으로 종목상태 도출`);
        return this.collectStockStatusesFromDart(basDd);
      }
      this.logger.error(`[KRX] 종목상태 수집 오류: ${(e as Error).message}`);
      return { processed, message: (e as Error).message };
    } finally {
      this.isStatusCollecting = false;
    }
  }

  /**
   * DART 공시 폴백만으로 종목상태(StockStatus)를 적재한다 (DAR-69).
   * KRX 미설정 시 사용. 상태 이벤트가 있는 기업만 갱신 — 정상 종목은 기본 false.
   */
  private async collectStockStatusesFromDart(
    basDd: string,
  ): Promise<{ processed: number; message?: string }> {
    const dartMap = await this.dartStockStatus.deriveAllStatuses();
    if (dartMap.size === 0) {
      this.logger.log(`[DART폴백] 관리종목·거래정지 상태 공시 없음`);
      return { processed: 0, message: 'DART 상태 공시 없음' };
    }

    const companies = await this.prisma.company.findMany({
      where: { corpCode: { in: [...dartMap.keys()] }, stockCode: { not: null } },
      select: { corpCode: true, stockCode: true },
    });

    let processed = 0;
    for (const c of companies) {
      if (!c.stockCode) continue;
      const d = dartMap.get(c.corpCode);
      if (!d || (!d.isManagement && !d.isHalted)) continue;

      await this.prisma.stockStatus.upsert({
        where: { stockCode: c.stockCode },
        create: {
          stockCode: c.stockCode,
          tradeDate: basDd,
          isTradingSuspended: d.isHalted,
          isManagement: d.isManagement,
          statusNote: d.statusNote,
        },
        update: {
          tradeDate: basDd,
          isTradingSuspended: d.isHalted,
          isManagement: d.isManagement,
          statusNote: d.statusNote,
        },
      });
      processed++;
    }

    this.logger.log(`[DART폴백] 종목상태 적재 완료 processed=${processed}`);
    return { processed };
  }

  /**
   * DART 공시 폴백 상태를 stockCode 키로 매핑한다 (KRX 병합용).
   */
  private async buildDartStatusByStockCode(): Promise<Map<string, DerivedStockStatus>> {
    const dartMap = await this.dartStockStatus.deriveAllStatuses();
    const byStockCode = new Map<string, DerivedStockStatus>();
    if (dartMap.size === 0) return byStockCode;

    const companies = await this.prisma.company.findMany({
      where: { corpCode: { in: [...dartMap.keys()] }, stockCode: { not: null } },
      select: { corpCode: true, stockCode: true },
    });
    for (const c of companies) {
      if (!c.stockCode) continue;
      const d = dartMap.get(c.corpCode);
      if (d) byStockCode.set(c.stockCode, d);
    }
    return byStockCode;
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
   * DAR-328: company.market 을 KOSPI/KOSDAQ 로 분류·백필한다.
   *
   * 배경: company.market 이 일반값('LISTED')·null 이면 EventStudy 가 시장지수(0001/1001)에
   * 매핑하지 못해 모든 관측을 noStockOrMarket 으로 스킵 → 공시↔주가 상관분석 데이터 0건.
   * KRX 종목기본정보(stk/ksq_isu_base_info)에 시장구분(KOSPI/KOSDAQ)이 있으므로 이를 정본
   * 소스로 company.market 을 갱신한다. AI 미개입 순수 데이터 정합 작업.
   *
   * - KONEX·미상은 갱신 대상에서 제외(지수 매핑 불가) — 기존 값 보존.
   * - 이미 올바른 시장으로 분류된 회사는 update 스킵(멱등).
   * - KRX 미설정/휴장 시 graceful 리턴(0 갱신) — 기존 분류 무손상.
   *
   * @returns scanned(stockCode 보유 회사수)·updated(시장값 갱신)·unmatched(기준정보 미존재)
   */
  async syncCompanyMarkets(
    basDd: string,
    triggeredBy: 'CRON' | 'MANUAL' = 'MANUAL',
  ): Promise<{ scanned: number; updated: number; unmatched: number; message?: string }> {
    const date = this.krx.parseDate(basDd);
    if (this.krx.isWeekend(date)) {
      return { scanned: 0, updated: 0, unmatched: 0, message: '주말 스킵' };
    }

    try {
      this.logger.log(`[KRX] 시장분류 동기화 시작 basDd=${basDd} [${triggeredBy}]`);

      const [stk, ksq] = await Promise.all([
        this.krx.fetchStkIsuBaseInfo(basDd),
        this.krx.fetchKsqIsuBaseInfo(basDd),
      ]);

      // stockCode → 'KOSPI' | 'KOSDAQ' (KONEX·빈코드 제외 — 시장지수 매핑 불가)
      const marketByStockCode = new Map<string, 'KOSPI' | 'KOSDAQ'>();
      for (const info of [...stk, ...ksq]) {
        if (!info.stockCode) continue;
        if (info.marketType !== 'KOSPI' && info.marketType !== 'KOSDAQ') continue;
        marketByStockCode.set(info.stockCode, info.marketType);
      }

      if (marketByStockCode.size === 0) {
        this.logger.warn('[KRX] 시장분류 동기화 — 기준정보 0행(휴장·미설정), 갱신 없음');
        return { scanned: 0, updated: 0, unmatched: 0, message: '기준정보 없음' };
      }

      const companies = await this.prisma.company.findMany({
        where: { stockCode: { not: null } },
        select: { corpCode: true, stockCode: true, market: true },
      });

      let updated = 0;
      let unmatched = 0;
      for (const c of companies) {
        if (!c.stockCode) continue;
        const market = marketByStockCode.get(c.stockCode);
        if (!market) {
          unmatched++;
          continue;
        }
        if (c.market === market) continue; // 이미 정확한 분류 — 멱등 스킵
        await this.prisma.company.update({
          where: { corpCode: c.corpCode },
          data: { market },
        });
        updated++;
      }

      this.logger.log(
        `[KRX] 시장분류 동기화 완료 scanned=${companies.length} updated=${updated} unmatched=${unmatched}`,
      );
      return { scanned: companies.length, updated, unmatched };
    } catch (e) {
      if (e instanceof KrxApiUnavailableError) {
        this.logger.warn(`[KRX] API 키 미설정 — 시장분류 동기화 스킵: ${(e as Error).message}`);
        return { scanned: 0, updated: 0, unmatched: 0, message: 'KRX API 미설정' };
      }
      this.logger.error(`[KRX] 시장분류 동기화 오류: ${(e as Error).message}`);
      return { scanned: 0, updated: 0, unmatched: 0, message: (e as Error).message };
    }
  }

  /**
   * EOD 통합 수집 + 수집 로그 기록 (수동 트리거용)
   */
  async collectAll(
    basDd: string,
    triggeredBy: 'CRON' | 'MANUAL' = 'MANUAL',
  ): Promise<{
    saved: number;
    skipped: number;
    indexSaved: number;
    statusProcessed: number;
    marketsUpdated: number;
  }> {
    const log = await this.prisma.marketDataCollectionLog.create({
      data: { tradeDate: basDd, triggeredBy, status: 'RUNNING' },
    });

    let savedCount = 0;
    let skippedCount = 0;
    let indexSaved = 0;
    let statusProcessed = 0;
    let marketsUpdated = 0;

    try {
      // DAR-328: 시장분류 동기화를 EOD 배치에 포함 — 신규/기존 company.market 을 KOSPI/KOSDAQ
      // 로 유지(매퍼). EventStudy 관측이 noStockOrMarket 으로 스킵되지 않도록 정합 보장.
      const [priceResult, indexResult, statusResult, marketResult] = await Promise.all([
        this.collectDailyPricesForDate(basDd, triggeredBy),
        this.collectMarketIndicesForDate(basDd, triggeredBy),
        this.collectStockStatusesForDate(basDd, triggeredBy),
        this.syncCompanyMarkets(basDd, triggeredBy),
      ]);

      savedCount = priceResult.saved;
      skippedCount = priceResult.skipped;
      indexSaved = indexResult.saved;
      statusProcessed = statusResult.processed;
      marketsUpdated = marketResult.updated;

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

      return { saved: savedCount, skipped: skippedCount, indexSaved, statusProcessed, marketsUpdated };
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
