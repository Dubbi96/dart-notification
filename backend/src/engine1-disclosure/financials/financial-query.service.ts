import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Persona P-B 스코어러·BuyScore keyMetric이 소비하는 재무지표 스냅샷.
 * BigInt 금액은 number(원)로 직렬화하여 스코어러가 곧바로 산식에 쓰도록 한다.
 */
export interface FinancialSnapshot {
  corpCode: string;
  stockCode: string | null;
  bsnsYear: string;
  reprtCode: string;
  fsDiv: string;
  revenue: number | null;
  operatingProfit: number | null;
  netIncome: number | null;
  totalAssets: number | null;
  totalLiabilities: number | null;
  totalEquity: number | null;
  eps: number | null;
  bps: number | null;
  roe: number | null;
  roa: number | null;
  debtRatio: number | null;
  per: number | null;
  pbr: number | null;
}

/**
 * 재무지표 조회 인터페이스 (DAR-52 연계 준비, 골격).
 *
 * Persona P-B(철학 스코어러)와 BuyScore keyMetric이 CompanyFinancial을 읽기 위한 진입점.
 * 엔진 간 통신 규약(DB 경유)을 따른다 — engine1이 수집·기록, 소비 엔진은 이 조회로 읽는다.
 * 읽기 전용, AI 미개입.
 */
@Injectable()
export class FinancialQueryService {
  constructor(private readonly prisma: PrismaService) {}

  /** 최신 재무지표 1건 (연도·보고서 내림차순). 없으면 null. */
  async getLatest(corpCode: string, fsDiv = 'CFS'): Promise<FinancialSnapshot | null> {
    const row = await this.prisma.companyFinancial.findFirst({
      where: { corpCode, fsDiv },
      orderBy: [{ bsnsYear: 'desc' }, { reprtCode: 'desc' }],
    });
    return row ? this.toSnapshot(row) : null;
  }

  /** 특정 기간 재무지표 (자연키 정확 조회). 없으면 null. */
  async getByPeriod(
    corpCode: string,
    bsnsYear: string,
    reprtCode: string,
    fsDiv = 'CFS',
  ): Promise<FinancialSnapshot | null> {
    const row = await this.prisma.companyFinancial.findUnique({
      where: {
        corpCode_bsnsYear_reprtCode_fsDiv: { corpCode, bsnsYear, reprtCode, fsDiv },
      },
    });
    return row ? this.toSnapshot(row) : null;
  }

  /** 여러 종목의 최신 재무지표 일괄 조회 — BuyScore 배치 채점용. */
  async getLatestForMany(
    corpCodes: string[],
    fsDiv = 'CFS',
  ): Promise<Map<string, FinancialSnapshot>> {
    const result = new Map<string, FinancialSnapshot>();
    for (const corpCode of corpCodes) {
      const snap = await this.getLatest(corpCode, fsDiv);
      if (snap) result.set(corpCode, snap);
    }
    return result;
  }

  private toSnapshot(row: {
    corpCode: string;
    stockCode: string | null;
    bsnsYear: string;
    reprtCode: string;
    fsDiv: string;
    revenue: bigint | null;
    operatingProfit: bigint | null;
    netIncome: bigint | null;
    totalAssets: bigint | null;
    totalLiabilities: bigint | null;
    totalEquity: bigint | null;
    eps: number | null;
    bps: number | null;
    roe: number | null;
    roa: number | null;
    debtRatio: number | null;
    per: number | null;
    pbr: number | null;
  }): FinancialSnapshot {
    const big = (v: bigint | null): number | null => (v == null ? null : Number(v));
    return {
      corpCode: row.corpCode,
      stockCode: row.stockCode,
      bsnsYear: row.bsnsYear,
      reprtCode: row.reprtCode,
      fsDiv: row.fsDiv,
      revenue: big(row.revenue),
      operatingProfit: big(row.operatingProfit),
      netIncome: big(row.netIncome),
      totalAssets: big(row.totalAssets),
      totalLiabilities: big(row.totalLiabilities),
      totalEquity: big(row.totalEquity),
      eps: row.eps,
      bps: row.bps,
      roe: row.roe,
      roa: row.roa,
      debtRatio: row.debtRatio,
      per: row.per,
      pbr: row.pbr,
    };
  }
}
