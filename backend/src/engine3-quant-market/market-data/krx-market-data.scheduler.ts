import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { KrxApiService, KrxApiUnavailableError } from './krx-api.service';
import { DartStockStatusService, DerivedStockStatus } from './dart-stock-status.service';
import type { Prisma } from '@prisma/client';
import { KST_TIMEZONE, kstIntradaySessionDate } from '../../common/time/kst';
import { MAX_INDEX_DAILY_CHANGE_PCT, isImplausibleIndexChange } from './index-sanity';
import { isValidDailyOhlc } from './daily-price-sanity';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';

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
    // DAR-428: EOD 일봉 캐치업 크론의 실행 헬스를 CronRunLog 에 기록(분봉과 대칭).
    //   @Global CronHealthModule 제공 — 미주입(테스트 등) 시 graceful 생략.
    @Optional() private readonly cronRunRecorder?: CronRunRecorderService,
  ) {}

  /**
   * 평일 18:30(KST) — 일봉 캐치업 수집 (DAR-375).
   * 단일 거래일이 아니라 '마지막 적재일~최신 가용일' 갭 전체를 멱등 백필한다.
   * 과거: resolveLatestAvailableTradeDate 가 저장소 최신일만 반환해 6/5 에 영원히 정체됐다.
   */
  @Cron('30 18 * * 1-5', { timeZone: KST_TIMEZONE })
  async collectDailyPrices(): Promise<{
    target: string;
    lastLoaded: string | null;
    filledDates: string[];
    emptyDates: string[];
    totalSaved: number;
    totalSkipped: number;
    message?: string;
  }> {
    return this.runDailyCollectWithHealth();
  }

  /**
   * 평일 21:00(KST) — 일봉 EOD 재시도 슬롯 (DAR-438).
   * KRX 는 EOD(종가) 일봉을 장 마감(15:30) 후 지연 게시하며 18:30 엔 미게시가 잦다.
   * 그 경우 `resolveLatestAvailableTradeDate` 프로브 target 이 직전 거래일에 머물러
   * 캐치업이 noop(갭 0) 되고, 당일분은 다음 평일 18:30 까지(금요일분은 주말 건너 약 사흘)
   * 스킵된다(F1 동일 구조). 21:00 엔 KRX 가 게시 완료해 있어 동일 멱등 캐치업을 재호출하면
   * target 이 당일로 전진해 같은 날 자가복구된다. 이미 적재됐으면 skipDuplicates 로 무해(0건).
   */
  @Cron('0 21 * * 1-5', { timeZone: KST_TIMEZONE })
  async retryCollectDailyPrices(): Promise<{
    target: string;
    lastLoaded: string | null;
    filledDates: string[];
    emptyDates: string[];
    totalSaved: number;
    totalSkipped: number;
    message?: string;
  }> {
    return this.runDailyCollectWithHealth();
  }

  /**
   * 일봉 캐치업을 cron-health(CronRunLog) 래핑으로 실행 (DAR-428).
   * 18:30 정시 슬롯과 21:00 재시도 슬롯이 동일 경로를 공유한다(SSOT).
   * recorder 미주입 시 기존 거동(직접 호출) 보존. 락 조기반환은 SKIPPED 로 기록.
   */
  private runDailyCollectWithHealth(): Promise<{
    target: string;
    lastLoaded: string | null;
    filledDates: string[];
    emptyDates: string[];
    totalSaved: number;
    totalSkipped: number;
    message?: string;
  }> {
    const run = () => this.catchUpDailyPrices('CRON');
    if (!this.cronRunRecorder) return run();
    return this.cronRunRecorder.record(CRON_JOB_KEYS.DAILY_PRICE_COLLECT, run, {
      countOf: (r) => r.totalSaved,
      isSkipped: (r) => r.message === '이전 작업 진행 중',
    });
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

  /**
   * 평일 18:45(KST) — 시장지수 캐치업 수집 (DAR-375).
   * 마지막 적재 지수일~최신 가용일 갭 전체를 멱등 백필(연속성 가드·휴장 스킵 포함).
   */
  @Cron('45 18 * * 1-5', { timeZone: KST_TIMEZONE })
  async collectMarketIndices(): Promise<{
    target: string;
    lastLoaded: string | null;
    filledDates: string[];
    totalSaved: number;
    quarantined: number;
    message?: string;
  }> {
    return this.catchUpMarketIndices('CRON');
  }

  /**
   * 평일 21:05(KST) — 시장지수 EOD 재시도 슬롯 (DAR-438).
   * 일봉(21:00)과 동일 근거 — 18:45 KRX 지수 미게시로 캐치업이 noop 된 당일분을
   * 게시 완료된 21:05 에 동일 멱등 캐치업으로 자가복구한다(연속성 가드·휴장 스킵 동일 적용).
   * 일봉 재시도 직후라 spine(일봉↔지수) 양쪽이 같은 날 함께 전진한다.
   */
  @Cron('5 21 * * 1-5', { timeZone: KST_TIMEZONE })
  async retryCollectMarketIndices(): Promise<{
    target: string;
    lastLoaded: string | null;
    filledDates: string[];
    totalSaved: number;
    quarantined: number;
    message?: string;
  }> {
    return this.catchUpMarketIndices('CRON');
  }

  async collectMarketIndicesForDate(
    basDd: string,
    triggeredBy: 'CRON' | 'MANUAL' = 'MANUAL',
  ): Promise<{ saved: number; quarantined?: number; message?: string }> {
    if (this.isIndexCollecting) {
      return { saved: 0, message: '이전 작업 진행 중' };
    }

    const date = this.krx.parseDate(basDd);
    if (this.krx.isWeekend(date)) {
      return { saved: 0, message: '주말 스킵' };
    }

    this.isIndexCollecting = true;
    let saved = 0;
    let quarantined = 0;

    try {
      this.logger.log(`[KRX] 지수 수집 시작 basDd=${basDd} [${triggeredBy}]`);

      for (const indexType of ['KOSPI', 'KOSDAQ'] as const) {
        const rows = await this.krx.fetchIndexDaily(indexType, basDd);

        for (const row of rows) {
          if (row.closeIndex === 0) continue;

          // DAR-367 연속성 sanity 가드: 직전 거래일 종가 대비 |Δ| 가 임계를 초과하면
          // 오염값으로 간주해 적재를 거부(격리)하고 경고 로그를 남긴다. 인접일 ±20% 초과는
          // 물리적으로 불가능한 수준이라 -63.75% 같은 오염값이 DB·홈 배지로 흘러가지 않게 한다.
          const prev = await this.prisma.marketIndex.findFirst({
            where: { indexCode: row.indexCode, tradeDate: { lt: basDd } },
            orderBy: { tradeDate: 'desc' },
            select: { closeIndex: true, tradeDate: true },
          });
          if (prev && isImplausibleIndexChange(row.closeIndex, prev.closeIndex)) {
            const deltaPct = ((row.closeIndex - prev.closeIndex) / prev.closeIndex) * 100;
            this.logger.warn(
              `[KRX] ${row.indexName} 연속성 이상치 격리 basDd=${basDd} close=${row.closeIndex} ` +
                `prev=${prev.closeIndex}(${prev.tradeDate}) Δ=${deltaPct.toFixed(2)}% ` +
                `(|Δ| > ${MAX_INDEX_DAILY_CHANGE_PCT}% 임계) — 적재 거부`,
            );
            quarantined++;
            continue;
          }

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

      this.logger.log(`[KRX] 지수 수집 완료 saved=${saved} quarantined=${quarantined}`);
      return quarantined > 0
        ? { saved, quarantined, message: `연속성 이상치 ${quarantined}건 격리` }
        : { saved, quarantined };
    } catch (e) {
      if (e instanceof KrxApiUnavailableError) {
        this.logger.warn(`[KRX] API 키 미설정 — 지수 수집 스킵`);
        return { saved: 0, message: 'KRX API 미설정' };
      }
      this.logger.error(`[KRX] 지수 수집 오류: ${(e as Error).message}`);
      return { saved, quarantined, message: (e as Error).message };
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
    return this.syncCompanyMarkets(await this.resolveLatestAvailableTradeDate(), 'CRON');
  }

  /** 평일 08:50(KST) — 종목상태 수집 (장 시작 전) */
  @Cron('50 8 * * 1-5', { timeZone: KST_TIMEZONE })
  async collectStockStatuses(): Promise<{ processed: number; message?: string }> {
    return this.collectStockStatusesForDate(await this.resolveLatestAvailableTradeDate(), 'CRON');
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
    basDd?: string,
    triggeredBy: 'CRON' | 'MANUAL' = 'MANUAL',
  ): Promise<{
    scanned: number;
    updated: number;
    unmatched: number;
    source?: 'BASE_INFO' | 'DAILY_FALLBACK';
    message?: string;
  }> {
    // DAR-329: basDd 미전달(수동 컨트롤러 body {}) 시 parseDate(undefined) 크래시(500) 방지.
    // DAR-331: 기본값을 today 대신 '최신 가용 거래일'로 해석 — 시스템 시계가 실제 KRX 데이터
    // 가용일보다 앞선 환경에서 today 를 조회하면 빈 응답(0건)이 되므로, StockDailyPrice 최신
    // tradeDate(우리 저장소가 가용으로 확인한 날)를 우선 사용한다(명시 basDd 가 항상 우선).
    const effectiveBasDd = await this.resolveLatestAvailableTradeDate(basDd);
    const date = this.krx.parseDate(effectiveBasDd);
    if (this.krx.isWeekend(date)) {
      return { scanned: 0, updated: 0, unmatched: 0, message: '주말 스킵' };
    }

    try {
      this.logger.log(`[KRX] 시장분류 동기화 시작 basDd=${effectiveBasDd} [${triggeredBy}]`);

      const [stk, ksq] = await Promise.all([
        this.krx.fetchStkIsuBaseInfo(effectiveBasDd),
        this.krx.fetchKsqIsuBaseInfo(effectiveBasDd),
      ]);

      // stockCode → 'KOSPI' | 'KOSDAQ' (KONEX·빈코드 제외 — 시장지수 매핑 불가)
      let source: 'BASE_INFO' | 'DAILY_FALLBACK' = 'BASE_INFO';
      const marketByStockCode = this.buildMarketMap([...stk, ...ksq]);

      // DAR-330: stk/ksq_isu_base_info 가 빈 응답이면(구독 게이트 또는 엔드포인트 미연동
      // 의심 — 일별매매정보는 정상 동작) 대체 소스로 일별매매정보(stk/ksq_bydd_trd)에서
      // 시장분류를 도출한다. 동일 인증·베이스URL·파싱을 공유하므로 base_info 불가 환경에서도
      // company.market 백필이 가능하다. 출처는 로그·리턴(source)에 명시한다.
      if (marketByStockCode.size === 0) {
        this.logger.warn(
          `[KRX] 시장분류 — isu_base_info 0행(stk=${stk.length} ksq=${ksq.length}). ` +
            `일별매매정보(stk/ksq_bydd_trd) 폴백으로 시장분류 도출 시도 ` +
            `(base_info 구독 미포함 또는 미연동 의심).`,
        );
        const fallback = await this.krx.fetchMarketClassificationFallback(effectiveBasDd);
        for (const [code, market] of this.buildMarketMap(fallback)) {
          marketByStockCode.set(code, market);
        }
        source = 'DAILY_FALLBACK';
        this.logger.warn(
          `[KRX] 시장분류 폴백 결과 — 일별매매정보 기준 분류 ${marketByStockCode.size}종목 ` +
            `(출처=DAILY_FALLBACK).`,
        );
      }

      if (marketByStockCode.size === 0) {
        this.logger.warn(
          '[KRX] 시장분류 동기화 — 기준정보·일별매매정보 모두 0행(휴장·미설정), 갱신 없음',
        );
        return { scanned: 0, updated: 0, unmatched: 0, source, message: '기준정보 없음' };
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
        `[KRX] 시장분류 동기화 완료 scanned=${companies.length} updated=${updated} ` +
          `unmatched=${unmatched} source=${source}`,
      );
      return { scanned: companies.length, updated, unmatched, source };
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
   * 기준정보/일별매매 행 배열에서 stockCode → 'KOSPI' | 'KOSDAQ' 맵을 만든다 (DAR-330).
   * KONEX·빈 코드는 제외(시장지수 매핑 불가) — base_info·폴백 양쪽이 공유하는 분류 규칙.
   */
  private buildMarketMap(
    infos: { stockCode: string; marketType: 'KOSPI' | 'KOSDAQ' | 'KONEX' }[],
  ): Map<string, 'KOSPI' | 'KOSDAQ'> {
    const map = new Map<string, 'KOSPI' | 'KOSDAQ'>();
    for (const info of infos) {
      if (!info.stockCode) continue;
      if (info.marketType !== 'KOSPI' && info.marketType !== 'KOSDAQ') continue;
      map.set(info.stockCode, info.marketType);
    }
    return map;
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

  /**
   * 기본 기준일을 '최신 가용 거래일'로 해석한다 (DAR-331 → DAR-375 근본 교정).
   *
   * 배경(실측 2026-06-19): 시스템 시계(today)가 실제 KRX 데이터 가용일보다 앞설 수 있다.
   * 그래서 today 를 그대로 조회하면 빈 응답(0건)이 된다.
   *
   * ★DAR-375 근본 버그: 이전 구현은 (b) StockDailyPrice 최신 tradeDate 를 '최신 가용일'로
   * 삼았다. 그러나 그 값은 "우리가 마지막으로 적재한 날"일 뿐 "KRX 가 보유한 최신일"이 아니다.
   * 저장소가 6/5 에 멈춰 있으면 resolver 가 영영 6/5 만 반환 → 크론이 매번 6/5 만 재수집 →
   * 6/8~6/18 가 KRX 에 존재함에도 영원히 전진하지 못하는 정체(self-fulfilling stale)가 발생했다.
   *
   * 교정: KRX 를 직접 프로빙해 '실제' 최신 가용 거래일을 산출한다.
   *
   * 우선순위:
   *   (a) 명시 basDd(8자리 YYYYMMDD) — 호출자 의도 우선, 그대로 사용.
   *   (b) ★KRX 라이브 프로브 — today 부터 과거로 평일을 순회하며 지수 데이터가 존재하는
   *       첫 거래일을 채택(= KRX 가 보유한 실제 최신 가용일). 저장소 상태와 무관하게 전진.
   *   (c) StockDailyPrice 최신 tradeDate — 프로브 불가(KRX 미설정·일시오류) 시 폴백.
   *   (d) today(주말이면 직전 평일로 클램프) — 저장소도 비었을 때의 부트스트랩 폴백.
   *
   * 미래일 클램프: (c)가 today 보다 미래면(비정상) today 로 클램프.
   *
   * 정직성: 임의 데이터 생성이 아니라 'KRX 실보유일' 산출이며, 시계 선행 시 WARN 로그를 남긴다.
   *
   * @param explicitBasDd 호출자가 지정한 기준일(있으면 우선)
   */
  async resolveLatestAvailableTradeDate(explicitBasDd?: string): Promise<string> {
    if (explicitBasDd && /^[0-9]{8}$/.test(explicitBasDd)) {
      return explicitBasDd;
    }

    const todayClamped = this.clampToLastWeekday(this.krx.formatDate(new Date()));

    // (b) KRX 라이브 프로브 — 저장소 적재 상태와 무관하게 실제 최신 가용일을 산출(DAR-375).
    const probed = await this.probeLatestAvailableTradeDate(todayClamped);
    if (probed) {
      if (probed < todayClamped) {
        this.logger.warn(
          `[KRX] 기준일 해석 — today(${todayClamped})에 KRX 데이터 미게시. ` +
            `프로브로 확인한 실제 최신 가용 거래일 ${probed} 사용.`,
        );
      }
      return probed;
    }

    // (c) 프로브 실패(KRX 미설정·일시오류) — 저장소 최신일 폴백.
    const latest = await this.prisma.stockDailyPrice.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    });
    if (!latest?.tradeDate) {
      // 저장소가 비어있음(부트스트랩) — today 로 시도.
      return todayClamped;
    }

    // 저장소 최신일이 today 보다 미래면(비정상) today 로 클램프.
    if (latest.tradeDate > todayClamped) {
      return todayClamped;
    }

    // 시계 선행 감지 — 최신 가용 거래일 사용을 명시(YYYYMMDD 문자열 사전식 비교 = 날짜순).
    if (latest.tradeDate < todayClamped) {
      this.logger.warn(
        `[KRX] 기준일 해석 — KRX 프로브 불가, 저장소 최신 거래일(${latest.tradeDate})로 폴백 ` +
          `(today=${todayClamped}).`,
      );
    }
    return latest.tradeDate;
  }

  /**
   * ★인트라데이(분봉·단타) 전용 거래일 해석 (DAR-423).
   *
   * `resolveLatestAvailableTradeDate` 는 'KRX 일봉 발행 여부' 프로브 기반이라, 일봉이 장 마감
   * 후 발행되는 특성상 장중엔 '오늘 일봉 미게시'로 직전 거래일을 반환한다. 일봉 맥락
   * (EventStudy·일봉 수집)에선 맞지만, 인트라데이(분봉/단타)는 일봉 발행과 무관하게 '오늘 라이브
   * 세션'이 거래일이다 — 장중인데 어제 라벨을 붙이면 분봉/단타 보유가 어제 기준으로 표시되는 버그.
   *
   * 분리 처방: 평일이고 KST 가 개장(≥09:00)이면 오늘(YYYYMMDD)을 그대로 거래일로 쓴다.
   *   장외(개장 전·주말·휴장)면 일봉 발행 기준(`resolveLatestAvailableTradeDate`)으로 폴백해
   *   직전 가용 거래일을 쓴다. 일봉 resolver 는 무변경(이중 의미 분리).
   *
   * ★graceful: 실제 휴장(평일이지만 KRX 휴장)이면 KIS 가 빈 분봉을 반환 → 유니버스 비고 신규
   *   거래 0 으로 안전(거짓 진입 없음). 휴장 캘린더 의존 없이 주말 + 빈 분봉으로 이중 보장.
   *
   * @param now 기준 시각(기본 현재) — 테스트에서 장중/장외 시각 주입.
   */
  async resolveIntradayTradeDate(now: Date = new Date()): Promise<string> {
    const sessionDate = kstIntradaySessionDate(now);
    if (sessionDate) return sessionDate;
    // 장외(개장 전·주말) — 일봉 발행 기준 직전 가용 거래일로 폴백.
    return this.resolveLatestAvailableTradeDate();
  }

  /**
   * KRX 를 직접 프로빙해 '실제' 최신 가용 거래일을 산출한다 (DAR-375).
   *
   * clampedStart 부터 과거로 평일을 순회하며, 지수(kospi_dd_trd) 응답이 비어있지 않은
   * (= KRX 가 해당일 데이터를 보유한) 첫 거래일을 채택한다. 지수 엔드포인트는 종합지수 1건만
   * 반환하는 경량 호출이라 가용성 프로브로 적합하다(전종목 일봉 조회보다 가볍다).
   *
   * - 미게시일(오늘·아직 마감 전): 빈 응답 → 다음(과거) 후보로.
   * - KRX 미설정(KrxApiUnavailableError): null 반환 → 호출자가 DB 최신일로 폴백.
   * - maxProbeWeekdays 회 안에 못 찾으면 null(장기 휴장·전체 미게시 등).
   *
   * @param clampedStart 프로브 시작일(YYYYMMDD, 보통 today 를 직전 평일로 클램프한 값)
   * @param maxProbeWeekdays 최대 프로브 평일 수(기본 10 — 연휴 포함 약 2주 커버)
   */
  async probeLatestAvailableTradeDate(
    clampedStart: string,
    maxProbeWeekdays = 10,
  ): Promise<string | null> {
    const cursor = this.krx.parseDate(clampedStart);
    let probed = 0;
    let guard = 0;
    while (probed < maxProbeWeekdays && guard < maxProbeWeekdays + 14) {
      guard++;
      if (this.krx.isWeekend(cursor)) {
        cursor.setDate(cursor.getDate() - 1);
        continue;
      }
      const candidate = this.krx.formatDate(cursor);
      cursor.setDate(cursor.getDate() - 1);
      probed++;
      try {
        const rows = await this.krx.fetchIndexDaily('KOSPI', candidate);
        if (rows.length > 0) {
          this.logger.log(`[KRX] 최신 가용일 프로브 — ${candidate} 데이터 확인(채택).`);
          return candidate;
        }
      } catch (e) {
        if (e instanceof KrxApiUnavailableError) {
          this.logger.warn('[KRX] 최신 가용일 프로브 — KRX 미설정, DB 최신일로 폴백');
          return null;
        }
        // 일시 오류는 다음(과거) 후보로 계속(graceful).
        this.logger.warn(
          `[KRX] 최신 가용일 프로브 ${candidate} 오류: ${(e as Error).message} — 다음 후보로`,
        );
      }
    }
    return null;
  }

  /** YYYYMMDD 가 주말이면 직전 평일(금요일)로 클램프한다 (DAR-331). */
  private clampToLastWeekday(yyyymmdd: string): string {
    const d = this.krx.parseDate(yyyymmdd);
    while (this.krx.isWeekend(d)) {
      d.setDate(d.getDate() - 1);
    }
    return this.krx.formatDate(d);
  }

  /**
   * fromExclusive(미포함) ~ toInclusive(포함) 사이의 평일 목록을 오름차순으로 만든다 (DAR-375).
   * 캐치업 백필이 채워야 할 후보 거래일(주말 제외) 산출용. from >= to 면 빈 배열(전진할 갭 없음).
   * YYYYMMDD 문자열 사전식 비교 = 날짜순. 휴장일은 여기서 거를 수 없으므로 수집 단계에서
   * rowsFetched=0 으로 스킵한다(상한 가드 400일).
   */
  private weekdaysAfter(fromExclusive: string, toInclusive: string): string[] {
    const out: string[] = [];
    if (!(fromExclusive < toInclusive)) return out;
    const cursor = this.krx.parseDate(fromExclusive);
    cursor.setDate(cursor.getDate() + 1);
    const endTime = this.krx.parseDate(toInclusive).getTime();
    let guard = 0;
    while (cursor.getTime() <= endTime && guard < 400) {
      guard++;
      if (!this.krx.isWeekend(cursor)) out.push(this.krx.formatDate(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  }

  /**
   * 데일리 일봉 캐치업 (DAR-375): 18:30 평일 크론 본체.
   *
   * 1) 최신 가용 거래일(target)을 KRX 프로브로 산출(저장소 정체와 무관하게 전진).
   * 2) 마지막 적재일(StockDailyPrice 최신 tradeDate)~target 사이 누락 거래일(주말 제외)을
   *    모두 멱등 백필한다(createMany skipDuplicates). 휴장일·미게시일(rowsFetched=0)은 스킵.
   * 3) MarketDataCollectionLog 에 캐치업 실행을 기록(관측성).
   *
   * 저장소가 비어 있으면(부트스트랩) target 1일만 수집한다 — 전체 히스토리는 backfillDailyPrices
   * 별도 경로. 이미 최신(lastLoaded ≥ target)이면 채울 거래일이 없어 즉시 리턴(멱등 no-op).
   */
  async catchUpDailyPrices(
    triggeredBy: 'CRON' | 'MANUAL' = 'CRON',
    opts: { delayMs?: number } = {},
  ): Promise<{
    target: string;
    lastLoaded: string | null;
    filledDates: string[];
    emptyDates: string[];
    totalSaved: number;
    totalSkipped: number;
    message?: string;
  }> {
    if (this.isDailyCollecting) {
      this.logger.warn('[KRX][캐치업] 일봉 수집이 이미 진행 중입니다.');
      return {
        target: '',
        lastLoaded: null,
        filledDates: [],
        emptyDates: [],
        totalSaved: 0,
        totalSkipped: 0,
        message: '이전 작업 진행 중',
      };
    }

    const target = await this.resolveLatestAvailableTradeDate();
    const last = await this.prisma.stockDailyPrice.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    });
    const lastLoaded = last?.tradeDate ?? null;

    const dates = this.computeCatchUpDates(lastLoaded, target);
    if (dates.length === 0) {
      this.logger.log(
        `[KRX][캐치업] 일봉 — 이미 최신(lastLoaded=${lastLoaded ?? '비어있음'} ≥ target=${target}), 채울 거래일 없음`,
      );
      return { target, lastLoaded, filledDates: [], emptyDates: [], totalSaved: 0, totalSkipped: 0 };
    }

    this.isDailyCollecting = true;
    const log = await this.prisma.marketDataCollectionLog.create({
      data: { tradeDate: target, triggeredBy, status: 'RUNNING' },
    });
    const filledDates: string[] = [];
    const emptyDates: string[] = [];
    let totalSaved = 0;
    let totalSkipped = 0;
    const delayMs = opts.delayMs ?? 0;

    try {
      this.logger.log(
        `[KRX][캐치업] 일봉 시작 lastLoaded=${lastLoaded ?? '비어있음'} target=${target} 후보=${dates.length}일`,
      );
      const corpCodeByStockCode = await this.loadCorpCodeMap();

      for (const basDd of dates) {
        const res = await this.collectDailyPricesBulkForDate(basDd, corpCodeByStockCode);
        if (res.rowsFetched === 0) {
          emptyDates.push(basDd); // 휴장일·미게시 — 거래일 아님
          continue;
        }
        filledDates.push(basDd);
        totalSaved += res.saved;
        totalSkipped += res.skipped;
        this.logger.log(
          `[KRX][캐치업] 일봉 ${basDd} saved=${res.saved} skipped=${res.skipped}`,
        );
        if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
      }

      const companies = await this.prisma.company.count({ where: { stockCode: { not: null } } });
      await this.prisma.marketDataCollectionLog.update({
        where: { id: log.id },
        data: {
          status: 'SUCCESS',
          stockCount: companies,
          savedCount: totalSaved,
          failedCount: totalSkipped,
          endedAt: new Date(),
        },
      });
      this.logger.log(
        `[KRX][캐치업] 일봉 완료 filled=${filledDates.length} empty=${emptyDates.length} saved=${totalSaved}`,
      );
      return { target, lastLoaded, filledDates, emptyDates, totalSaved, totalSkipped };
    } catch (e) {
      const unavailable = e instanceof KrxApiUnavailableError;
      await this.prisma.marketDataCollectionLog.update({
        where: { id: log.id },
        data: {
          status: 'FAILED',
          savedCount: totalSaved,
          failedCount: totalSkipped,
          errorMessage: unavailable ? 'KRX API 미설정' : (e as Error).message,
          endedAt: new Date(),
        },
      });
      if (unavailable) {
        this.logger.warn('[KRX][캐치업] 일봉 — KRX 미설정, 스킵');
        return {
          target,
          lastLoaded,
          filledDates,
          emptyDates,
          totalSaved,
          totalSkipped,
          message: 'KRX API 미설정',
        };
      }
      this.logger.error(`[KRX][캐치업] 일봉 오류: ${(e as Error).message}`);
      return {
        target,
        lastLoaded,
        filledDates,
        emptyDates,
        totalSaved,
        totalSkipped,
        message: (e as Error).message,
      };
    } finally {
      this.isDailyCollecting = false;
    }
  }

  /**
   * 데일리 지수 캐치업 (DAR-375): 18:45 평일 크론 본체.
   * 마지막 적재 지수일(MarketIndex 최신 tradeDate)~target 사이 누락 거래일의 지수를 멱등 백필한다.
   * 일봉과 별도 spine(MarketIndex 자체 최신일)으로 갭을 계산해, 일봉만 적재되고 지수가 누락된
   * 케이스도 독립적으로 메운다. collectMarketIndicesForDate 가 휴장·미설정·연속성 가드를 처리한다.
   */
  async catchUpMarketIndices(
    triggeredBy: 'CRON' | 'MANUAL' = 'CRON',
  ): Promise<{
    target: string;
    lastLoaded: string | null;
    filledDates: string[];
    totalSaved: number;
    quarantined: number;
    message?: string;
  }> {
    const target = await this.resolveLatestAvailableTradeDate();
    const last = await this.prisma.marketIndex.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    });
    const lastLoaded = last?.tradeDate ?? null;

    const dates = this.computeCatchUpDates(lastLoaded, target);
    if (dates.length === 0) {
      this.logger.log(
        `[KRX][캐치업] 지수 — 이미 최신(lastLoaded=${lastLoaded ?? '비어있음'} ≥ target=${target})`,
      );
      return { target, lastLoaded, filledDates: [], totalSaved: 0, quarantined: 0 };
    }

    const filledDates: string[] = [];
    let totalSaved = 0;
    let quarantined = 0;
    this.logger.log(
      `[KRX][캐치업] 지수 시작 lastLoaded=${lastLoaded ?? '비어있음'} target=${target} 후보=${dates.length}일`,
    );
    for (const basDd of dates) {
      const res = await this.collectMarketIndicesForDate(basDd, triggeredBy);
      if (res.saved > 0) filledDates.push(basDd);
      totalSaved += res.saved;
      quarantined += res.quarantined ?? 0;
    }
    this.logger.log(
      `[KRX][캐치업] 지수 완료 filled=${filledDates.length} saved=${totalSaved} quarantined=${quarantined}`,
    );
    return { target, lastLoaded, filledDates, totalSaved, quarantined };
  }

  /**
   * 평일·토 03:00(KST) — 시장지수 과거 깊이 백필 (DAR-398).
   * EventStudy baseline 재산출(토 04:00) 직전에 지수 결손을 메워, 과거 공시 이벤트의
   * 시장 기준선(초과수익 AR) 결측으로 인한 noIndexPrices 전량 스킵을 해소한다.
   * 멱등: 이미 채워졌으면 no-op. throw 금지(스케줄 유지).
   */
  @Cron('0 3 * * *', { timeZone: KST_TIMEZONE })
  async backfillMarketIndexHistoryCron(): Promise<void> {
    try {
      await this.backfillMarketIndexHistory({ triggeredBy: 'CRON' });
    } catch (e) {
      this.logger.error(`[KRX][지수백필] 크론 오류: ${(e as Error).message}`);
    }
  }

  /**
   * 시장지수 과거 깊이 백필 (DAR-398) — EventStudy 초과수익(AR) 산출의 시장 기준선.
   *
   * 근본 문제: market_indices 가 최근 일부 거래일만 보유해, 과거 공시 이벤트의 지수
   * 윈도(D±N)가 비어 EventStudy 가 전량 noIndexPrices 로 스킵됐다(공시↔등락 근거 0).
   * 종목 일봉(stock_daily_prices)·corpCode→stockCode 연결은 정상이었다(DAR-398 진단).
   *
   * 대상 거래일은 stock_daily_prices 에 실재하는 거래일(= KRX 가 데이터를 가진 영업일,
   * 휴장일 자동 제외)에서 market_indices 에 아직 없는 날짜만 오래된 순으로 고른다.
   * 수집은 collectMarketIndicesForDate 를 재사용 — 연속성 가드(±20%)·휴장 빈응답·
   * KRX 미설정 graceful·멱등 upsert 가 그대로 적용된다.
   *
   * @param opts.fromDate/toDate 거래일 범위(YYYYMMDD, 포함). 미지정 시 전체.
   * @param opts.maxDays 1회 수집 상한(기본 500) — 쿼터/부하 보호.
   */
  async backfillMarketIndexHistory(
    opts: {
      fromDate?: string;
      toDate?: string;
      maxDays?: number;
      triggeredBy?: 'CRON' | 'MANUAL';
    } = {},
  ): Promise<{
    tradingDays: number;
    missing: number;
    filledDates: string[];
    totalSaved: number;
    quarantined: number;
    message?: string;
  }> {
    const triggeredBy = opts.triggeredBy ?? 'MANUAL';
    const maxDays = opts.maxDays ?? 500;

    const dateFilter =
      opts.fromDate || opts.toDate
        ? {
            tradeDate: {
              ...(opts.fromDate ? { gte: opts.fromDate } : {}),
              ...(opts.toDate ? { lte: opts.toDate } : {}),
            },
          }
        : {};

    // 거래일 캘린더: stock_daily_prices 에 실재하는 거래일(휴장일 자동 제외)
    const stockDateRows = await this.prisma.stockDailyPrice.findMany({
      where: dateFilter,
      distinct: ['tradeDate'],
      select: { tradeDate: true },
      orderBy: { tradeDate: 'asc' },
    });
    const tradeDates = stockDateRows.map((r) => r.tradeDate);

    // 이미 지수가 적재된 거래일
    const indexDateRows = await this.prisma.marketIndex.findMany({
      where: dateFilter,
      distinct: ['tradeDate'],
      select: { tradeDate: true },
    });
    const haveIndex = new Set(indexDateRows.map((r) => r.tradeDate));

    const missing = tradeDates.filter((d) => !haveIndex.has(d)).slice(0, maxDays);

    if (missing.length === 0) {
      this.logger.log(
        `[KRX][지수백필] 결손 없음 — 거래일=${tradeDates.length} 모두 지수 보유 [${triggeredBy}]`,
      );
      return {
        tradingDays: tradeDates.length,
        missing: 0,
        filledDates: [],
        totalSaved: 0,
        quarantined: 0,
        message: '백필 불필요(지수 결손 없음)',
      };
    }

    const filledDates: string[] = [];
    let totalSaved = 0;
    let quarantined = 0;
    this.logger.log(
      `[KRX][지수백필] 시작 거래일=${tradeDates.length} 누락=${missing.length} (cap=${maxDays}) ` +
        `범위=${missing[0]}~${missing[missing.length - 1]} [${triggeredBy}]`,
    );
    // 오래된 순으로 채워 연속성 가드(직전 거래일 대비)가 자연 성립하게 한다.
    for (const basDd of missing) {
      const res = await this.collectMarketIndicesForDate(basDd, triggeredBy);
      if (res.saved > 0) filledDates.push(basDd);
      totalSaved += res.saved;
      quarantined += res.quarantined ?? 0;
    }
    this.logger.log(
      `[KRX][지수백필] 완료 filled=${filledDates.length} saved=${totalSaved} quarantined=${quarantined}`,
    );
    return {
      tradingDays: tradeDates.length,
      missing: missing.length,
      filledDates,
      totalSaved,
      quarantined,
    };
  }

  /**
   * 캐치업이 채워야 할 거래일 목록을 산출한다 (DAR-375 공유 헬퍼).
   * - lastLoaded 없음(저장소 비어있음): [target] — 부트스트랩 1일.
   * - lastLoaded < target: 그 사이 평일 전부(누락 갭) — 휴장일은 수집 단계에서 스킵.
   * - lastLoaded ≥ target: [] — 이미 최신, 신규 거래일 없음(멱등 no-op).
   */
  private computeCatchUpDates(lastLoaded: string | null, target: string): string[] {
    if (!lastLoaded) return [target];
    if (lastLoaded < target) return this.weekdaysAfter(lastLoaded, target);
    return [];
  }

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
      // DAR-376 품질 가드: 종목코드 부재·OHLC 손상(0/음수·고<저·시·종 범위 밖) 행은 적재 거부.
      // EventStudy backbone 에 물리적으로 불가능한 가격이 섞이지 않도록 행 단위로 차단한다.
      if (!row.stockCode || !isValidDailyOhlc(row)) {
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

  /**
   * 재개 가능한 과거 깊이 백필 (DAR-376).
   *
   * 기존 `backfillDailyPrices` 는 항상 endDate(기본 today)부터 과거로 days 거래일을 수집해, 반복
   * 실행 시 이미 적재된 최근 구간을 다시 훑는다(멱등이라 무손상이나 비효율). 깊이 백필은 '가장
   * 오래된 적재일의 직전 일자'부터 더 과거로 이어 수집해 **호출마다 과거 범위를 확장**한다(재개 가능).
   * 운영자가 같은 명령을 반복 실행하기만 하면 KRX 제공 한도까지 점진적으로 깊어진다.
   *
   * - resumeFrom = StockDailyPrice 최소 tradeDate − 1일(있으면) / today(저장소 비었을 때 부트스트랩).
   * - days 거래일만큼 추가 과거 적재(멱등 createMany skipDuplicates·휴장일 스킵·품질 가드 적용).
   * - `MarketDataCollectionLog`(RUNNING→SUCCESS/PARTIAL/FAILED) 로 진행 기록(관측성·재개 추적).
   * - KRX 한도 소진(연속 휴장·미제공)은 backfillDailyPrices 의 maxLookback 가드로 자연 종료.
   */
  async backfillDailyHistoryDeep(
    opts: { days?: number; delayMs?: number } = {},
  ): Promise<{
    resumedFrom: string;
    earliestBefore: string | null;
    requestedDays: number;
    collectedDays: number;
    totalSaved: number;
    dateRange: { from: string | null; to: string | null };
    message?: string;
  }> {
    const days = opts.days ?? 120;

    const earliest = await this.prisma.stockDailyPrice.findFirst({
      orderBy: { tradeDate: 'asc' },
      select: { tradeDate: true },
    });
    const earliestBefore = earliest?.tradeDate ?? null;

    // resumeFrom: 가장 오래된 적재일의 직전 일자부터 더 과거로(없으면 today 부트스트랩).
    let resumeFrom: string;
    if (earliestBefore) {
      const c = this.krx.parseDate(earliestBefore);
      c.setDate(c.getDate() - 1);
      resumeFrom = this.krx.formatDate(c);
    } else {
      resumeFrom = this.krx.formatDate(new Date());
    }

    this.logger.log(
      `[KRX][깊이백필] 시작 earliestBefore=${earliestBefore ?? '비어있음'} resumeFrom=${resumeFrom} days=${days}`,
    );

    const log = await this.prisma.marketDataCollectionLog.create({
      data: { tradeDate: resumeFrom, triggeredBy: 'MANUAL', status: 'RUNNING' },
    });
    try {
      const res = await this.backfillDailyPrices({ days, endDate: resumeFrom, delayMs: opts.delayMs });
      await this.prisma.marketDataCollectionLog.update({
        where: { id: log.id },
        data: {
          status: res.message ? 'PARTIAL' : 'SUCCESS',
          savedCount: res.totalSaved,
          failedCount: res.totalSkipped,
          errorMessage: res.message ?? null,
          endedAt: new Date(),
        },
      });
      this.logger.log(
        `[KRX][깊이백필] 완료 collectedDays=${res.collectedDays} totalSaved=${res.totalSaved} ` +
          `range=${JSON.stringify(res.dateRange)}`,
      );
      return {
        resumedFrom: resumeFrom,
        earliestBefore,
        requestedDays: days,
        collectedDays: res.collectedDays,
        totalSaved: res.totalSaved,
        dateRange: res.dateRange,
        message: res.message,
      };
    } catch (e) {
      await this.prisma.marketDataCollectionLog.update({
        where: { id: log.id },
        data: { status: 'FAILED', errorMessage: (e as Error).message, endedAt: new Date() },
      });
      throw e;
    }
  }

  /**
   * 일봉 적재 커버리지·갭 리포트 (DAR-376).
   *
   * EventStudy 가 돌 데이터가 충분한지·어떤 종목/구간이 비었는지 운영 가시성을 제공한다.
   * - universeSize: stockCode 보유 Company 수(분석 유니버스).
   * - stocksWithData / missingStockCount(+sample): 일봉이 1행이라도 있는 종목 vs 전무 종목.
   * - tradeDateMin/Max·tradingDayCount: 적재된 거래일 범위·일수.
   * - totalRows: 총 일봉 행수.
   */
  async getDailyCoverageReport(missingSampleSize = 20): Promise<{
    universeSize: number;
    stocksWithData: number;
    missingStockCount: number;
    missingStockSample: string[];
    tradeDateMin: string | null;
    tradeDateMax: string | null;
    tradingDayCount: number;
    totalRows: number;
  }> {
    const companies = await this.prisma.company.findMany({
      where: { stockCode: { not: null } },
      select: { stockCode: true },
    });
    const universe = new Set(
      companies.map((c) => c.stockCode).filter((s): s is string => s !== null),
    );

    const [agg, byStock, byDate, totalRows] = await Promise.all([
      this.prisma.stockDailyPrice.aggregate({
        _min: { tradeDate: true },
        _max: { tradeDate: true },
      }),
      this.prisma.stockDailyPrice.groupBy({ by: ['stockCode'] }),
      this.prisma.stockDailyPrice.groupBy({ by: ['tradeDate'] }),
      this.prisma.stockDailyPrice.count(),
    ]);

    const stocksWith = new Set((byStock as Array<{ stockCode: string }>).map((g) => g.stockCode));
    const missing = [...universe].filter((s) => !stocksWith.has(s));

    return {
      universeSize: universe.size,
      stocksWithData: stocksWith.size,
      missingStockCount: missing.length,
      missingStockSample: missing.slice(0, missingSampleSize),
      tradeDateMin: agg._min.tradeDate ?? null,
      tradeDateMax: agg._max.tradeDate ?? null,
      tradingDayCount: (byDate as Array<unknown>).length,
      totalRows,
    };
  }
}
