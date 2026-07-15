import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * InvestorFlowQueryService — 수급·공매도 조회 (갭분석 W16 ③, read-only).
 *
 * 모바일 '수급 요약' 카드가 소비하는 조회 전용 계층. 최근 N거래일 시계열 + 누적 요약
 * (외국인·기관 5/20일 누적 순매수 금액)을 반환한다. BigInt 컬럼은 JSON 직렬화를 위해
 * number 로 변환한다(일별 순매수 금액 최대 ~조 단위 → Number.MAX_SAFE_INTEGER 내 안전).
 *
 * ★정직: asOfDate(데이터 기준일)를 항상 동반 — stale 데이터 숨김 금지(소비측 배지 표기).
 * ★SHADOW 불가침: 표면 계층 전용 — Buy Score·트레이딩 경로 무접점(점수화하지 않는다).
 */

/** 투자자별 매매동향 1행(API 응답 — 금액 원 단위 number). */
export interface InvestorFlowRowDto {
  tradeDate: string;
  foreignNetBuyQty: number;
  foreignNetBuyAmount: number;
  institutionNetBuyQty: number;
  institutionNetBuyAmount: number;
  individualNetBuyQty: number;
  individualNetBuyAmount: number;
  source: string;
}

/** 외국인·기관 누적 순매수 요약(최근 5/20거래일, 원). */
export interface InvestorFlowSummaryDto {
  foreignNet5dAmount: number;
  foreignNet20dAmount: number;
  institutionNet5dAmount: number;
  institutionNet20dAmount: number;
  /** 요약에 실제 반영된 거래일 수(5/20 미만 축적 시 정직 고지). */
  window5dDays: number;
  window20dDays: number;
}

export interface InvestorFlowResultDto {
  stockCode: string;
  /** 데이터 기준일(최신 적재 거래일 YYYYMMDD). 데이터 없으면 null — 소비측 카드 억제. */
  asOfDate: string | null;
  rows: InvestorFlowRowDto[];
  summary: InvestorFlowSummaryDto | null;
}

/** 공매도 일별 1행(API 응답). 잔고 필드는 소스 미가용 시 null(합성 금지). */
export interface ShortSellingRowDto {
  tradeDate: string;
  shortSellingVolume: number;
  shortSellingAmount: number | null;
  shortBalanceQty: number | null;
  shortBalanceRatio: number | null;
  /** 공매도 거래비중(% — 당일 총거래량 대비, 일봉 volume 조인 산출). 산출 불가 시 null. */
  shortVolumeRatio: number | null;
  publishedDate: string;
  source: string;
}

export interface ShortSellingResultDto {
  stockCode: string;
  /** 데이터 기준일(최신 적재 거래일 YYYYMMDD). 데이터 없으면 null — 소비측 카드 억제. */
  asOfDate: string | null;
  rows: ShortSellingRowDto[];
}

const DEFAULT_DAYS = 20;
const MAX_DAYS = 120;

@Injectable()
export class InvestorFlowQueryService {
  private readonly logger = new Logger(InvestorFlowQueryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** days 파라미터 정규화(기본 20, 상한 120 — 모바일 대량 전송 금지). */
  static normalizeDays(days?: string | number): number {
    const n = typeof days === 'string' ? parseInt(days, 10) : (days ?? DEFAULT_DAYS);
    if (!Number.isFinite(n) || (n as number) <= 0) return DEFAULT_DAYS;
    return Math.min(n as number, MAX_DAYS);
  }

  /**
   * 종목 투자자별 매매동향 — 최근 days 거래일(내림차순 조회 후 오름차순 반환) + 5/20일 누적 요약.
   * 형식 위반 코드·데이터 없음은 빈 결과 graceful(asOfDate=null).
   */
  async getInvestorFlow(stockCode: string, days?: string | number): Promise<InvestorFlowResultDto> {
    const code = (stockCode ?? '').trim();
    if (!/^\d{6}$/.test(code)) {
      return { stockCode: code, asOfDate: null, rows: [], summary: null };
    }
    const take = Math.max(InvestorFlowQueryService.normalizeDays(days), 20); // 20일 요약 확보
    const found = await this.prisma.investorFlowDaily.findMany({
      where: { stockCode: code },
      orderBy: { tradeDate: 'desc' },
      take,
    });
    if (found.length === 0) {
      return { stockCode: code, asOfDate: null, rows: [], summary: null };
    }

    const rowsDesc: InvestorFlowRowDto[] = found.map((r) => ({
      tradeDate: r.tradeDate,
      foreignNetBuyQty: Number(r.foreignNetBuyQty),
      foreignNetBuyAmount: Number(r.foreignNetBuyAmount),
      institutionNetBuyQty: Number(r.institutionNetBuyQty),
      institutionNetBuyAmount: Number(r.institutionNetBuyAmount),
      individualNetBuyQty: Number(r.individualNetBuyQty),
      individualNetBuyAmount: Number(r.individualNetBuyAmount),
      source: r.source,
    }));

    const summary = InvestorFlowQueryService.summarize(rowsDesc);
    const requested = InvestorFlowQueryService.normalizeDays(days);
    return {
      stockCode: code,
      asOfDate: rowsDesc[0].tradeDate,
      rows: rowsDesc.slice(0, requested).reverse(), // 오름차순(시계열) 반환
      summary,
    };
  }

  /**
   * 외국인·기관 5/20거래일 누적 순매수 금액 요약 (W16 유닛 스펙 대상 — 순수 함수).
   * @param rowsDesc 최신순(내림차순) 정렬 행 — 최근 5/20개를 그대로 합산한다.
   */
  static summarize(rowsDesc: InvestorFlowRowDto[]): InvestorFlowSummaryDto {
    const sum = (rows: InvestorFlowRowDto[], pick: (r: InvestorFlowRowDto) => number): number =>
      rows.reduce((acc, r) => acc + pick(r), 0);
    const w5 = rowsDesc.slice(0, 5);
    const w20 = rowsDesc.slice(0, 20);
    return {
      foreignNet5dAmount: sum(w5, (r) => r.foreignNetBuyAmount),
      foreignNet20dAmount: sum(w20, (r) => r.foreignNetBuyAmount),
      institutionNet5dAmount: sum(w5, (r) => r.institutionNetBuyAmount),
      institutionNet20dAmount: sum(w20, (r) => r.institutionNetBuyAmount),
      window5dDays: w5.length,
      window20dDays: w20.length,
    };
  }

  /**
   * 종목 공매도 일별 — 최근 days 거래일(오름차순 반환). 공매도 거래비중(%)은 동일
   * (stockCode, tradeDate) 일봉 volume 과 조인해 산출한다(잔고비율 미가용 환경의 정직 대체 지표).
   */
  async getShortSelling(stockCode: string, days?: string | number): Promise<ShortSellingResultDto> {
    const code = (stockCode ?? '').trim();
    if (!/^\d{6}$/.test(code)) {
      return { stockCode: code, asOfDate: null, rows: [] };
    }
    const take = InvestorFlowQueryService.normalizeDays(days);
    const found = await this.prisma.shortSellingDaily.findMany({
      where: { stockCode: code },
      orderBy: { tradeDate: 'desc' },
      take,
    });
    if (found.length === 0) {
      return { stockCode: code, asOfDate: null, rows: [] };
    }

    // 공매도 거래비중 산출용 일봉 volume 일괄 조인(단일 in 쿼리 — N+1 회피).
    const tradeDates = found.map((r) => r.tradeDate);
    const dailyPrices = await this.prisma.stockDailyPrice.findMany({
      where: { stockCode: code, tradeDate: { in: tradeDates } },
      select: { tradeDate: true, volume: true },
    });
    const volumeByDate = new Map(dailyPrices.map((p) => [p.tradeDate, Number(p.volume)]));

    const rowsDesc: ShortSellingRowDto[] = found.map((r) => {
      const shortVolume = Number(r.shortSellingVolume);
      const totalVolume = volumeByDate.get(r.tradeDate);
      return {
        tradeDate: r.tradeDate,
        shortSellingVolume: shortVolume,
        shortSellingAmount: r.shortSellingAmount != null ? Number(r.shortSellingAmount) : null,
        shortBalanceQty: r.shortBalanceQty != null ? Number(r.shortBalanceQty) : null,
        shortBalanceRatio: r.shortBalanceRatio,
        shortVolumeRatio:
          totalVolume && totalVolume > 0
            ? Math.round((shortVolume / totalVolume) * 10000) / 100
            : null,
        publishedDate: r.publishedDate,
        source: r.source,
      };
    });

    return {
      stockCode: code,
      asOfDate: rowsDesc[0].tradeDate,
      rows: rowsDesc.reverse(), // 오름차순(시계열) 반환
    };
  }
}
