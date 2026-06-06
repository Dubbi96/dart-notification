import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CollectionMaturity,
  CollectionRunStatus,
  CollectionStatusDto,
} from './dto/collection-status.dto';

// 수집 성숙도 임계치 — 이 값 이상 누적되면 '충분'으로 본다. 카드별 도메인 특성에 맞춰 분리.
// read-only 집계 전용 상수(외부호출·수집로직 없음). 운영 기준 변경 시 여기만 조정.
const SUFFICIENT_THRESHOLD = {
  disclosure: 100,
  financial: 50,
  indicator: 50,
  simulation: 5,
} as const;

@Injectable()
export class CollectionStatusService {
  private readonly logger = new Logger(CollectionStatusService.name);

  constructor(private readonly prisma: PrismaService) {}

  // 수집 파이프라인(공시·재무·지표·모의) 횡단 집계. 기존 테이블 count/max(updatedAt) 만 사용.
  // 신규 수집 로직·외부호출·AI 개입 없음(read-only).
  async getStatus(): Promise<CollectionStatusDto> {
    const [disclosure, financial, indicator, simulation] = await Promise.all([
      this.getDisclosureCoverage(),
      this.getFinancialCoverage(),
      this.getIndicatorCoverage(),
      this.getSimulationCoverage(),
    ]);

    return {
      disclosure,
      financial,
      indicator,
      simulation,
      generatedAt: new Date().toISOString(),
    };
  }

  private maturity(count: number, sufficient: number): CollectionMaturity {
    if (count <= 0) return 'WAITING';
    if (count >= sufficient) return 'SUFFICIENT';
    return 'COLLECTING';
  }

  private toIso(date: Date | null | undefined): string | null {
    return date ? date.toISOString() : null;
  }

  // 수집 로그의 종료시각 우선, 진행중(endedAt null)이면 시작시각으로 대체.
  private logTimestamp(log: { startedAt: Date; endedAt: Date | null } | null): string | null {
    if (!log) return null;
    return this.toIso(log.endedAt ?? log.startedAt);
  }

  private async getDisclosureCoverage() {
    const [totalCount, lastLog] = await Promise.all([
      this.prisma.disclosure.count(),
      this.prisma.disclosureCollectionLog.findFirst({
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true, endedAt: true, newCount: true, status: true },
      }),
    ]);

    return {
      totalCount,
      lastCollectedAt: this.logTimestamp(lastLog),
      lastNewCount: lastLog?.newCount ?? 0,
      lastStatus: (lastLog?.status ?? null) as CollectionRunStatus,
      maturity: this.maturity(totalCount, SUFFICIENT_THRESHOLD.disclosure),
    };
  }

  private async getFinancialCoverage() {
    const [covered, latest, lastLog] = await Promise.all([
      // distinct 종목 수 — groupBy 후 행 개수. (집계 read-only)
      this.prisma.companyFinancial.groupBy({ by: ['corpCode'] }),
      this.prisma.companyFinancial.findFirst({
        orderBy: [{ bsnsYear: 'desc' }, { reprtCode: 'desc' }],
        select: { bsnsYear: true, reprtCode: true },
      }),
      this.prisma.financialCollectionLog.findFirst({
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true, endedAt: true, status: true },
      }),
    ]);

    const coveredCompanies = covered.length;
    return {
      coveredCompanies,
      latestPeriod: latest ? `${latest.bsnsYear} / ${latest.reprtCode}` : null,
      lastCollectedAt: this.logTimestamp(lastLog),
      lastStatus: (lastLog?.status ?? null) as CollectionRunStatus,
      maturity: this.maturity(coveredCompanies, SUFFICIENT_THRESHOLD.financial),
    };
  }

  private async getIndicatorCoverage() {
    const [covered, latest, lastLog] = await Promise.all([
      this.prisma.technicalIndicator.groupBy({ by: ['stockCode'] }),
      this.prisma.technicalIndicator.findFirst({
        orderBy: { tradeDate: 'desc' },
        select: { tradeDate: true },
      }),
      this.prisma.marketDataCollectionLog.findFirst({
        orderBy: { startedAt: 'desc' },
        select: { startedAt: true, endedAt: true, status: true },
      }),
    ]);

    const coveredStocks = covered.length;
    return {
      coveredStocks,
      latestTradeDate: latest?.tradeDate ?? null,
      lastCollectedAt: this.logTimestamp(lastLog),
      lastStatus: (lastLog?.status ?? null) as CollectionRunStatus,
      maturity: this.maturity(coveredStocks, SUFFICIENT_THRESHOLD.indicator),
    };
  }

  private async getSimulationCoverage() {
    const [openPositions, totalTrades, lastTrade] = await Promise.all([
      this.prisma.position.count({ where: { status: 'OPEN' } }),
      this.prisma.paperTrade.count(),
      this.prisma.paperTrade.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    return {
      openPositions,
      totalTrades,
      lastTradeAt: this.toIso(lastTrade?.createdAt ?? null),
      maturity: this.maturity(openPositions, SUFFICIENT_THRESHOLD.simulation),
    };
  }
}
