import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  DartApiService,
  DartApiUnavailableError,
  DART_REPORT_CODE,
  DartReportCode,
  DartFsDiv,
  CompanyFinancialMetrics,
} from '../dart-api/dart-api.service';
import { computeGrowthSeries, PeriodFinancials } from './financial-growth';

export interface CollectFinancialsOptions {
  bsnsYear: string; // 사업연도 (예: '2025')
  reprtCode?: DartReportCode; // 보고서코드 (기본: 사업보고서 11011)
  fsDiv?: DartFsDiv; // CFS(기본) | OFS
  /** 명시 corpCode 목록. 미지정 시 우선순위 큐로 자동 선별. */
  corpCodes?: string[];
  triggeredBy?: 'MANUAL' | 'CRON' | 'EVENT';
  /** 호출 간 지연(ms) — DART 레이트리밋 graceful. 기본 300ms. */
  rateLimitMs?: number;
  /**
   * 자동 선별 상한. 미지정(undefined) 시 **무제한**(캡 해제 — DAR-55) — 우선순위 큐 전체 순회.
   * 명시 corpCodes 에도 적용(slice).
   */
  limit?: number;
  /**
   * 자동 선별 범위 (corpCodes 미지정 시) — DAR-55:
   * - 'PRIORITY'(기본): 신호·이벤트·관심목록 보유 종목만 (DAR-52 호환).
   * - 'ALL': 전종목 우선순위 큐 — 신호 → 이벤트 → 관심 → 시총상위(거래대금) → 나머지 전체.
   */
  scope?: 'PRIORITY' | 'ALL';
}

export interface BackfillTimeSeriesOptions {
  /** 백필 대상 사업연도 목록 (예: ['2024','2023']). */
  bsnsYears: string[];
  /** 백필할 보고서코드. 미지정 시 11011·11012·11013·11014 전체(분기 시계열). */
  reprtCodes?: DartReportCode[];
  fsDiv?: DartFsDiv;
  /** 명시 corpCodes. 미지정 시 scope 에 따라 자동 선별. */
  corpCodes?: string[];
  scope?: 'PRIORITY' | 'ALL';
  limit?: number;
  rateLimitMs?: number;
  triggeredBy?: 'MANUAL' | 'CRON' | 'EVENT';
  /**
   * 백필 완료 후 YoY/QoQ 성장률 산출·영속 여부 — DAR-93. 기본 true.
   * (다년 적재가 끝난 뒤 직전 기간을 찾을 수 있어 백필 직후 1회 재계산한다.)
   */
  computeGrowth?: boolean;
}

export interface BackfillTimeSeriesResult {
  periods: number; // 처리한 (연도×보고서) 조합 수
  totalSaved: number;
  totalSkipped: number;
  totalFailed: number;
  /** 성장률(YoY/QoQ)을 산출·영속한 재무 행 수 — DAR-93. */
  growthUpdated: number;
  results: CollectFinancialsResult[];
}

export interface CollectFinancialsResult {
  logId: string | null;
  bsnsYear: string;
  reprtCode: string;
  fsDiv: DartFsDiv;
  target: number;
  saved: number;
  skipped: number;
  failed: number;
  status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  message?: string;
}

/** 분기 시계열 백필용 전체 보고서코드 (사업·반기·1Q·3Q) — DAR-55. */
export const ALL_QUARTERLY_REPORT_CODES: DartReportCode[] = [
  DART_REPORT_CODE.ANNUAL,
  DART_REPORT_CODE.HALF,
  DART_REPORT_CODE.Q1,
  DART_REPORT_CODE.Q3,
];

/**
 * 재무지표 수집 서비스 (DAR-52 기반, DAR-55 전종목 확대).
 *
 * DART 단일회사 전체 재무제표(fnlttSinglAcntAll) → CompanyFinancial 멱등 upsert.
 * - 우선순위 큐: 신호 → 이벤트 → 관심 → 시총상위(거래대금) → 나머지 전체.
 * - scope:'ALL' + limit 미지정 시 **캡 해제** — 전종목 순회(DAR-55).
 * - 자연키(corpCode+연도+보고서+구분) 기반 멱등 — 재실행해도 중복 row 0.
 * - 분기 시계열 백필(reprtCode 11011~11014) — 추세 분석 토대(스키마 변경 0).
 * - DART 레이트리밋 graceful: 호출 간 지연 + 키 미설정 시 안전 종료.
 * - AI 미개입(순수 데이터/Rule).
 */
@Injectable()
export class FinancialCollectionService {
  private readonly logger = new Logger(FinancialCollectionService.name);
  private readonly DEFAULT_RATE_LIMIT_MS = 300;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dartApi: DartApiService,
  ) {}

  /**
   * 우선 수집 대상 corpCode 선별 — 신호(TradingSignal)·이벤트(DisclosureEvent) 보유 종목 우선,
   * 없으면 관심목록(WatchList) 보유 종목. 모두 비면 빈 배열.
   *
   * @param limit 상한. 미지정(undefined) 시 **무제한**(DAR-55 캡 해제) — 세 티어 전부 순회.
   */
  async selectPriorityCorpCodes(limit?: number): Promise<string[]> {
    const cap = limit ?? Number.POSITIVE_INFINITY;
    const seen = new Set<string>();
    const add = (codes: { corpCode: string }[]) => {
      for (const c of codes) {
        if (c.corpCode) seen.add(c.corpCode);
      }
    };

    add(
      await this.prisma.tradingSignal.findMany({
        distinct: ['corpCode'],
        select: { corpCode: true },
      }),
    );
    if (seen.size < cap) {
      add(
        await this.prisma.disclosureEvent.findMany({
          distinct: ['corpCode'],
          select: { corpCode: true },
        }),
      );
    }
    if (seen.size < cap) {
      add(
        await this.prisma.watchList.findMany({
          distinct: ['corpCode'],
          select: { corpCode: true },
        }),
      );
    }

    const all = Array.from(seen);
    return Number.isFinite(cap) ? all.slice(0, cap) : all;
  }

  /**
   * 전종목 우선순위 큐 (DAR-55) — 신호 → 이벤트 → 관심 → 시총상위(거래대금) → 나머지 전체.
   * 동일 corpCode 는 상위 티어 우선 1회만. limit 미지정 시 전 종목(상장사) 반환.
   *
   * "시총상위" 는 별도 시총 컬럼이 없어 최신 거래일 tradingValue(거래대금) 내림차순을 프록시로 사용
   * (유동성·규모 비례 — Persona/BuyScore 적용 가치가 높은 순). 정확한 시총 컬럼 도입은 후속 스코프.
   */
  async selectAllMarketTargets(limit?: number): Promise<string[]> {
    const cap = limit ?? Number.POSITIVE_INFINITY;
    const ordered: string[] = [];
    const seen = new Set<string>();
    const push = (codes: { corpCode: string | null }[]) => {
      for (const c of codes) {
        if (ordered.length >= cap) return;
        if (c.corpCode && !seen.has(c.corpCode)) {
          seen.add(c.corpCode);
          ordered.push(c.corpCode);
        }
      }
    };

    // 티어 1: 신호 보유
    push(
      await this.prisma.tradingSignal.findMany({
        distinct: ['corpCode'],
        select: { corpCode: true },
      }),
    );
    // 티어 2: 공시 이벤트 보유
    if (ordered.length < cap) {
      push(
        await this.prisma.disclosureEvent.findMany({
          distinct: ['corpCode'],
          select: { corpCode: true },
        }),
      );
    }
    // 티어 3: 관심목록
    if (ordered.length < cap) {
      push(
        await this.prisma.watchList.findMany({
          distinct: ['corpCode'],
          select: { corpCode: true },
        }),
      );
    }
    // 티어 4: 시총상위(거래대금 프록시) — 최신 거래일 기준 내림차순
    if (ordered.length < cap) {
      push(await this.selectByTradingValue());
    }
    // 티어 5: 나머지 전체 상장 종목 (corpName 정렬 — 결정론적)
    if (ordered.length < cap) {
      push(
        await this.prisma.company.findMany({
          where: { stockCode: { not: null } },
          select: { corpCode: true },
          orderBy: { corpName: 'asc' },
        }),
      );
    }

    return ordered;
  }

  /**
   * 최신 거래일의 거래대금(tradingValue) 내림차순 corpCode — 시총상위 프록시.
   * StockDailyPrice 가 비면 빈 배열.
   */
  private async selectByTradingValue(): Promise<{ corpCode: string }[]> {
    const latest = await this.prisma.stockDailyPrice.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    });
    if (!latest) return [];

    const rows = await this.prisma.stockDailyPrice.findMany({
      where: { tradeDate: latest.tradeDate, tradingValue: { not: null } },
      orderBy: { tradingValue: 'desc' },
      select: { corpCode: true },
    });
    return rows;
  }

  /**
   * 단일 기업 재무지표 수집·upsert.
   * @returns 'SAVED' | 'SKIPPED'(데이터 없음) — DartApiUnavailableError는 상위로 전파.
   */
  async collectForCorpCode(
    corpCode: string,
    opts: { bsnsYear: string; reprtCode: DartReportCode; fsDiv: DartFsDiv },
  ): Promise<'SAVED' | 'SKIPPED'> {
    const res = await this.dartApi.fetchSingleCompanyFinancials({
      corpCode,
      bsnsYear: opts.bsnsYear,
      reprtCode: opts.reprtCode,
      fsDiv: opts.fsDiv,
    });

    const items = res.list ?? [];
    if (items.length === 0) {
      return 'SKIPPED';
    }

    const metrics = this.dartApi.extractFinancialMetrics(items);
    // 핵심 지표가 전부 비면 의미 없는 행 → 스킵
    if (metrics.totalAssets == null && metrics.revenue == null && metrics.netIncome == null) {
      return 'SKIPPED';
    }

    const stockCode = await this.lookupStockCode(corpCode);
    const rceptNo = items[0]?.rcept_no ?? null;

    const data = {
      corpCode,
      stockCode,
      bsnsYear: opts.bsnsYear,
      reprtCode: opts.reprtCode,
      fsDiv: opts.fsDiv,
      revenue: this.toBigInt(metrics.revenue),
      operatingProfit: this.toBigInt(metrics.operatingProfit),
      netIncome: this.toBigInt(metrics.netIncome),
      totalAssets: this.toBigInt(metrics.totalAssets),
      totalLiabilities: this.toBigInt(metrics.totalLiabilities),
      totalEquity: this.toBigInt(metrics.totalEquity),
      eps: metrics.eps,
      roe: metrics.roe,
      roa: metrics.roa,
      debtRatio: metrics.debtRatio,
      rceptNo,
    };

    await this.prisma.companyFinancial.upsert({
      where: {
        corpCode_bsnsYear_reprtCode_fsDiv: {
          corpCode,
          bsnsYear: opts.bsnsYear,
          reprtCode: opts.reprtCode,
          fsDiv: opts.fsDiv,
        },
      },
      create: data,
      update: data,
    });

    return 'SAVED';
  }

  /**
   * 배치 수집 — 우선 종목(또는 명시 corpCodes) 순회, 멱등 upsert, 레이트리밋 graceful.
   * 실행 이력은 FinancialCollectionLog에 기록한다.
   */
  async collectBatch(opts: CollectFinancialsOptions): Promise<CollectFinancialsResult> {
    const reprtCode = opts.reprtCode ?? DART_REPORT_CODE.ANNUAL;
    const fsDiv: DartFsDiv = opts.fsDiv ?? 'CFS';
    const triggeredBy = opts.triggeredBy ?? 'MANUAL';
    // DAR-55: limit 미지정 시 캡 해제(무제한). slice(0, undefined) 는 전체 반환.
    const limit = opts.limit;
    const scope = opts.scope ?? 'PRIORITY';
    const rateLimitMs = opts.rateLimitMs ?? this.DEFAULT_RATE_LIMIT_MS;

    let corpCodes: string[];
    if (opts.corpCodes && opts.corpCodes.length > 0) {
      corpCodes = opts.corpCodes.slice(0, limit);
    } else if (scope === 'ALL') {
      corpCodes = await this.selectAllMarketTargets(limit);
    } else {
      corpCodes = await this.selectPriorityCorpCodes(limit);
    }

    const log = await this.prisma.financialCollectionLog.create({
      data: {
        bsnsYear: opts.bsnsYear,
        reprtCode,
        fsDiv,
        triggeredBy,
        status: 'RUNNING',
        targetCount: corpCodes.length,
      },
    });

    let saved = 0;
    let skipped = 0;
    let failed = 0;

    if (corpCodes.length === 0) {
      await this.finalizeLog(log.id, 'SUCCESS', { saved, skipped, failed });
      return {
        logId: log.id,
        bsnsYear: opts.bsnsYear,
        reprtCode,
        fsDiv,
        target: 0,
        saved,
        skipped,
        failed,
        status: 'SUCCESS',
        message: '수집 대상 종목 없음',
      };
    }

    for (let i = 0; i < corpCodes.length; i++) {
      const corpCode = corpCodes[i];
      try {
        const r = await this.collectForCorpCode(corpCode, {
          bsnsYear: opts.bsnsYear,
          reprtCode,
          fsDiv,
        });
        if (r === 'SAVED') saved++;
        else skipped++;
      } catch (err) {
        if (err instanceof DartApiUnavailableError) {
          // 키 미설정/오프라인 — 더 호출해도 의미 없음. 안전 종료.
          this.logger.warn('DART API 미설정 — 재무지표 수집 중단(graceful)');
          await this.finalizeLog(log.id, 'FAILED', {
            saved,
            skipped,
            failed,
            errorMessage: 'DART API 미설정',
          });
          return {
            logId: log.id,
            bsnsYear: opts.bsnsYear,
            reprtCode,
            fsDiv,
            target: corpCodes.length,
            saved,
            skipped,
            failed,
            status: 'FAILED',
            message: 'DART API 미설정',
          };
        }
        failed++;
        this.logger.warn(`재무지표 수집 실패 (${corpCode}): ${(err as Error).message}`);
      }

      // 마지막 항목 뒤에는 지연 불필요
      if (rateLimitMs > 0 && i < corpCodes.length - 1) {
        await this.sleep(rateLimitMs);
      }
    }

    const status: CollectFinancialsResult['status'] = failed === 0 ? 'SUCCESS' : 'PARTIAL';
    await this.finalizeLog(log.id, status, { saved, skipped, failed });

    return {
      logId: log.id,
      bsnsYear: opts.bsnsYear,
      reprtCode,
      fsDiv,
      target: corpCodes.length,
      saved,
      skipped,
      failed,
      status,
    };
  }

  /**
   * 분기 시계열 백필 (DAR-55) — bsnsYears × reprtCodes(기본 11011~11014) 조합을
   * 순차 collectBatch 로 수집한다. 자연키(corpCode+기간+보고서) 멱등이라 재실행 무손상.
   *
   * DART 호출량이 크므로(연도×보고서×종목) 레이트리밋 graceful 을 그대로 따른다.
   * 키 미설정(FAILED)으로 한 조합이 중단되면 이후 조합 호출은 무의미 → 즉시 중단한다.
   */
  async backfillTimeSeries(
    opts: BackfillTimeSeriesOptions,
  ): Promise<BackfillTimeSeriesResult> {
    const reprtCodes =
      opts.reprtCodes && opts.reprtCodes.length > 0
        ? opts.reprtCodes
        : ALL_QUARTERLY_REPORT_CODES;
    const triggeredBy = opts.triggeredBy ?? 'MANUAL';
    const fsDiv: DartFsDiv = opts.fsDiv ?? 'CFS';
    const computeGrowth = opts.computeGrowth ?? true;

    // DAR-93: 대상 corpCode 를 1회 확정한다. 성장률 재계산 대상을 고정하고,
    // 기간 간 동일 종목 집합을 보장(스코프 자동선별이 기간마다 흔들리지 않도록)한다.
    let corpCodes: string[];
    if (opts.corpCodes && opts.corpCodes.length > 0) {
      corpCodes =
        opts.limit != null ? opts.corpCodes.slice(0, opts.limit) : opts.corpCodes;
    } else if (opts.scope === 'ALL') {
      corpCodes = await this.selectAllMarketTargets(opts.limit);
    } else {
      corpCodes = await this.selectPriorityCorpCodes(opts.limit);
    }

    const results: CollectFinancialsResult[] = [];
    let totalSaved = 0;
    let totalSkipped = 0;
    let totalFailed = 0;
    let apiUnavailable = false;

    outer: for (const bsnsYear of opts.bsnsYears) {
      for (const reprtCode of reprtCodes) {
        const r = await this.collectBatch({
          bsnsYear,
          reprtCode,
          fsDiv,
          corpCodes,
          triggeredBy,
          rateLimitMs: opts.rateLimitMs,
        });
        results.push(r);
        totalSaved += r.saved;
        totalSkipped += r.skipped;
        totalFailed += r.failed;

        // DART 키 미설정 — 이후 조합 호출 무의미. 안전 중단.
        if (r.status === 'FAILED' && r.message === 'DART API 미설정') {
          this.logger.warn('DART API 미설정 — 분기 백필 중단(graceful)');
          apiUnavailable = true;
          break outer;
        }
      }
    }

    // DAR-93: 다년 적재 완료 후 YoY/QoQ 성장률 산출·영속(직전 기간 확보 시점).
    // API 미설정으로 중단된 경우엔 새 데이터가 없어 재계산 생략.
    let growthUpdated = 0;
    if (computeGrowth && !apiUnavailable && corpCodes.length > 0) {
      growthUpdated = await this.recomputeGrowthForCorpCodes(corpCodes, fsDiv);
    }

    return {
      periods: results.length,
      totalSaved,
      totalSkipped,
      totalFailed,
      growthUpdated,
      results,
    };
  }

  /**
   * DAR-93: 종목별 다년 재무 시계열 → YoY/QoQ 성장률 산출·영속.
   *
   * CompanyFinancial 의 다년/분기 행을 읽어 매출·영업이익·EPS 의 전년동기·전기 성장률을
   * 순수 함수(computeGrowthSeries)로 계산하고, 변동이 있는 행만 update 한다.
   * 직전 기간이 없으면 성장률은 null(결측 폴백). 읽기→파생→영속만, AI 미개입.
   *
   * @returns 성장률을 갱신한 행 수.
   */
  async recomputeGrowthForCorpCodes(
    corpCodes: string[],
    fsDiv: DartFsDiv = 'CFS',
  ): Promise<number> {
    let updated = 0;
    for (const corpCode of corpCodes) {
      const rows = await this.prisma.companyFinancial.findMany({
        where: { corpCode, fsDiv },
        select: {
          id: true,
          bsnsYear: true,
          reprtCode: true,
          revenue: true,
          operatingProfit: true,
          eps: true,
          revenueGrowthYoY: true,
          operatingProfitGrowthYoY: true,
          epsGrowthYoY: true,
          revenueGrowthQoQ: true,
          operatingProfitGrowthQoQ: true,
          epsGrowthQoQ: true,
        },
      });
      if (rows.length === 0) continue;

      const series = computeGrowthSeries(
        rows.map(
          (r): PeriodFinancials => ({
            bsnsYear: r.bsnsYear,
            reprtCode: r.reprtCode,
            revenue: r.revenue == null ? null : Number(r.revenue),
            operatingProfit:
              r.operatingProfit == null ? null : Number(r.operatingProfit),
            eps: r.eps,
          }),
        ),
      );

      for (const row of rows) {
        const g = series.get(`${row.bsnsYear}:${row.reprtCode}`);
        if (!g) continue;
        // 변동 없는 행은 쓰기 생략(멱등 재실행 시 불필요한 update 방지).
        if (
          row.revenueGrowthYoY === g.revenueGrowthYoY &&
          row.operatingProfitGrowthYoY === g.operatingProfitGrowthYoY &&
          row.epsGrowthYoY === g.epsGrowthYoY &&
          row.revenueGrowthQoQ === g.revenueGrowthQoQ &&
          row.operatingProfitGrowthQoQ === g.operatingProfitGrowthQoQ &&
          row.epsGrowthQoQ === g.epsGrowthQoQ
        ) {
          continue;
        }
        await this.prisma.companyFinancial.update({
          where: { id: row.id },
          data: g,
        });
        updated++;
      }
    }
    return updated;
  }

  private async lookupStockCode(corpCode: string): Promise<string | null> {
    const c = await this.prisma.company.findUnique({
      where: { corpCode },
      select: { stockCode: true },
    });
    return c?.stockCode ?? null;
  }

  private toBigInt(n: number | null): bigint | null {
    if (n == null || !isFinite(n)) return null;
    return BigInt(Math.round(n));
  }

  private async finalizeLog(
    id: string,
    status: 'SUCCESS' | 'PARTIAL' | 'FAILED',
    counts: { saved: number; skipped: number; failed: number; errorMessage?: string },
  ): Promise<void> {
    await this.prisma.financialCollectionLog.update({
      where: { id },
      data: {
        status,
        savedCount: counts.saved,
        skippedCount: counts.skipped,
        failedCount: counts.failed,
        errorMessage: counts.errorMessage ?? null,
        endedAt: new Date(),
      },
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
