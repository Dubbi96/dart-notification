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

export interface CollectFinancialsOptions {
  bsnsYear: string; // 사업연도 (예: '2025')
  reprtCode?: DartReportCode; // 보고서코드 (기본: 사업보고서 11011)
  fsDiv?: DartFsDiv; // CFS(기본) | OFS
  /** 명시 corpCode 목록. 미지정 시 신호·이벤트 보유 우선 종목을 자동 선별. */
  corpCodes?: string[];
  triggeredBy?: 'MANUAL' | 'CRON';
  /** 호출 간 지연(ms) — DART 레이트리밋 graceful. 기본 300ms. */
  rateLimitMs?: number;
  /** 자동 선별 시 상한 (기본 50). 전체 2700사 확대는 후속 스코프. */
  limit?: number;
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

/**
 * 재무지표 수집 서비스 (DAR-52).
 *
 * DART 단일회사 전체 재무제표(fnlttSinglAcntAll) → CompanyFinancial 멱등 upsert.
 * - 우선 신호/이벤트 보유 종목부터 배치 수집 (전체 2700사는 후속 확대).
 * - 자연키(corpCode+연도+보고서+구분) 기반 멱등 — 재실행해도 중복 row 0.
 * - DART 레이트리밋 graceful: 호출 간 지연 + 키 미설정 시 안전 종료.
 * - AI 미개입(순수 데이터/Rule).
 */
@Injectable()
export class FinancialCollectionService {
  private readonly logger = new Logger(FinancialCollectionService.name);
  private readonly DEFAULT_RATE_LIMIT_MS = 300;
  private readonly DEFAULT_LIMIT = 50;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dartApi: DartApiService,
  ) {}

  /**
   * 우선 수집 대상 corpCode 선별 — 신호(TradingSignal)·이벤트(DisclosureEvent) 보유 종목 우선,
   * 없으면 관심목록(WatchList) 보유 종목. 모두 비면 빈 배열.
   */
  async selectPriorityCorpCodes(limit: number): Promise<string[]> {
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
    if (seen.size < limit) {
      add(
        await this.prisma.disclosureEvent.findMany({
          distinct: ['corpCode'],
          select: { corpCode: true },
        }),
      );
    }
    if (seen.size < limit) {
      add(
        await this.prisma.watchList.findMany({
          distinct: ['corpCode'],
          select: { corpCode: true },
        }),
      );
    }

    return Array.from(seen).slice(0, limit);
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
    const limit = opts.limit ?? this.DEFAULT_LIMIT;
    const rateLimitMs = opts.rateLimitMs ?? this.DEFAULT_RATE_LIMIT_MS;

    const corpCodes =
      opts.corpCodes && opts.corpCodes.length > 0
        ? opts.corpCodes.slice(0, limit)
        : await this.selectPriorityCorpCodes(limit);

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
