/**
 * SimulationPriceSourceService — 모의운용 시세 소스 추상화 (DAR-124)
 *
 * 모의운용이 읽는 일봉 소스를 한 곳으로 모은다. 두 모드(혼합 금지 — 한 런은 한 모드만):
 *   - 실데이터 모드(기본): 기존 그대로 StockDailyPrice(실 KRX 일봉)를 읽는다. 회귀 0.
 *   - 합성 모드(PAPER_SIM_SYNTHETIC_FEED=1): SimulatedDailyPrice(결정적 합성 일봉)만 읽는다.
 *     환경 시계가 미래(2026)라 실 KRX 일봉이 없을 때 30일 트랙레코드가 의미를 갖게 한다.
 *
 * ★신뢰 원칙(불가침): 합성 가격은 '모의/시뮬레이션' 전용이다. 실시세로 표시하지 않으며
 *   실데이터와 혼합하지 않는다(소스 테이블 물리 분리 + 모드 단일). 합성 가격은 이 서비스를
 *   통해 PaperSimulation 만 소비한다 — 기업 현재가/지표/신호 등 실가격 경로는 미참조.
 *
 * AI 금지영역: 가격 생성은 순수 시드 PRNG(Rule). 체결·주문수량·하드룰과 무관.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  generateSyntheticSeries,
  tradingDaysEndingAt,
  SyntheticBar,
} from './synthetic-price-feed';
import {
  SIM_MIN_ENTRY_GRADE,
  entryEligibleGrades,
  dedupeCandidatesByCorpCode,
} from './simulation-entry';

/** 모의운용이 소비하는 일봉 1행(소스 무관 공통 형태). volume 은 스냅샷 BigInt 컬럼 정합. */
export interface SimPriceRow {
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  volume: bigint;
}

/** 합성 시계열 고정 앵커일(YYYYMMDD). 슬라이딩 윈도가 아니라 고정 앵커에서 워크해야
 *  특정 (stockCode, tradeDate) 의 종가가 재실행마다 동일(결정·멱등)하다. */
export const SYNTHETIC_ANCHOR_DATE = '20260101';
/** 합성 일봉을 실제로 적재할 trailing 거래일 수(30일 트랙 + D+5 여유). */
export const SYNTHETIC_PERSIST_TRADING_DAYS = 60;
/** 진입 후보 유니버스 상한(합성 적재 대상 종목 수 가드). */
const CANDIDATE_UNIVERSE_CAP = 200;

@Injectable()
export class SimulationPriceSourceService {
  private readonly logger = new Logger(SimulationPriceSourceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** 합성 모드 여부(환경 플래그). 기본 false → 실데이터 모드(회귀 0). */
  get isSynthetic(): boolean {
    const v = (process.env.PAPER_SIM_SYNTHETIC_FEED ?? '').toLowerCase();
    return v === '1' || v === 'true' || v === 'on';
  }

  /**
   * 사이클 직전 유니버스 준비 — 합성 모드에서만 동작. 실데이터 모드는 no-op.
   * 보유 OPEN 포지션 + 진입 후보 종목에 대해 tradeDate 까지의 합성 일봉을 멱등 적재한다.
   * @returns 적재 대상 종목 수·신규 삽입 행 수(없으면 0).
   */
  async prepareUniverse(
    portfolioId: string,
    tradeDate: string,
  ): Promise<{ stocks: number; inserted: number }> {
    if (!this.isSynthetic) return { stocks: 0, inserted: 0 };

    const stocks = await this.resolveUniverse(portfolioId);
    if (stocks.length === 0) return { stocks: 0, inserted: 0 };

    const dates = this.persistDates(tradeDate);
    if (dates.length === 0) return { stocks: stocks.length, inserted: 0 };

    let inserted = 0;
    for (const s of stocks) {
      const bars = this.seriesFor(s.stockCode, tradeDate);
      const data: Prisma.SimulatedDailyPriceCreateManyInput[] = bars
        .filter((b) => dates.includes(b.tradeDate))
        .map((b) => this.toCreateInput(s.corpCode, s.stockCode, b));
      if (data.length === 0) continue;
      // 합성 일봉은 결정적·불변 → createMany skipDuplicates(멱등, 빠름).
      const res = await this.prisma.simulatedDailyPrice.createMany({
        data,
        skipDuplicates: true,
      });
      inserted += res.count;
    }
    this.logger.log(
      `[SimPriceSource][합성] 유니버스 준비 stocks=${stocks.length} inserted=${inserted} tradeDate=${tradeDate}`,
    );
    return { stocks: stocks.length, inserted };
  }

  /** tradeDate 이하의 가장 최신 일봉 1행(소스 모드별). 없으면 null. */
  async latestPriceRow(corpCode: string, tradeDate: string): Promise<SimPriceRow | null> {
    if (this.isSynthetic) {
      const row = await this.prisma.simulatedDailyPrice.findFirst({
        where: { corpCode, tradeDate: { lte: tradeDate } },
        orderBy: { tradeDate: 'desc' },
        select: this.rowSelect,
      });
      return row ?? null;
    }
    const row = await this.prisma.stockDailyPrice.findFirst({
      where: { corpCode, tradeDate: { lte: tradeDate } },
      orderBy: { tradeDate: 'desc' },
      select: this.rowSelect,
    });
    return row ?? null;
  }

  /** afterTradeDate 초과 거래일의 종가 take 개(오름차순). Exit 정확도(D+3) 산출용. */
  async closesAfter(
    corpCode: string,
    afterTradeDate: string,
    take: number,
  ): Promise<Array<{ closePrice: number }>> {
    if (this.isSynthetic) {
      return this.prisma.simulatedDailyPrice.findMany({
        where: { corpCode, tradeDate: { gt: afterTradeDate } },
        orderBy: { tradeDate: 'asc' },
        select: { closePrice: true },
        take,
      });
    }
    return this.prisma.stockDailyPrice.findMany({
      where: { corpCode, tradeDate: { gt: afterTradeDate } },
      orderBy: { tradeDate: 'asc' },
      select: { closePrice: true },
      take,
    });
  }

  // ─── 내부 ───────────────────────────────────────────────────────────────

  private readonly rowSelect = {
    openPrice: true,
    highPrice: true,
    lowPrice: true,
    closePrice: true,
    volume: true,
  } as const;

  /** 적재 대상 거래일 목록(trailing 윈도, tradeDate 포함). */
  private persistDates(tradeDate: string): string[] {
    return tradingDaysEndingAt(tradeDate, SYNTHETIC_PERSIST_TRADING_DAYS);
  }

  /**
   * 한 종목의 합성 시계열 — 고정 앵커에서 tradeDate 까지 워크 후 trailing 윈도만 반환.
   * 앵커 고정 덕에 특정 거래일의 종가는 재실행마다 동일(멱등 적재 정합).
   */
  private seriesFor(stockCode: string, tradeDate: string): SyntheticBar[] {
    // tradeDate 가 주말이면 tradingDaysEndingAt/Between 이 직전 거래일부터 처리(내부 보정).
    // 앵커→tradeDate 전체 거래일(연속 워크). 앵커가 tradeDate 이후면 trailing 윈도로 폴백.
    const allDates =
      SYNTHETIC_ANCHOR_DATE <= tradeDate
        ? this.tradingDaysBetween(SYNTHETIC_ANCHOR_DATE, tradeDate)
        : tradingDaysEndingAt(tradeDate, SYNTHETIC_PERSIST_TRADING_DAYS);
    const series = generateSyntheticSeries(stockCode, allDates);
    return series.slice(-SYNTHETIC_PERSIST_TRADING_DAYS);
  }

  /** [from..to] 거래일 오름차순(주말 제외). from/to 포함(거래일이면). */
  private tradingDaysBetween(from: string, to: string): string[] {
    // tradingDaysEndingAt 으로 to 에서 과거로 충분히 센 뒤 from 이상만 절단.
    // 최대 앵커~to 거래일 수를 넉넉히(달력일 차 / 7 * 5 + 여유) 추정.
    const span = this.calendarDayDiff(from, to);
    const estimate = Math.ceil((span / 7) * 5) + 10;
    const all = tradingDaysEndingAt(to, Math.max(estimate, SYNTHETIC_PERSIST_TRADING_DAYS));
    return all.filter((d) => d >= from);
  }

  private calendarDayDiff(from: string, to: string): number {
    const f = Date.UTC(
      Number(from.slice(0, 4)),
      Number(from.slice(4, 6)) - 1,
      Number(from.slice(6, 8)),
    );
    const t = Date.UTC(
      Number(to.slice(0, 4)),
      Number(to.slice(4, 6)) - 1,
      Number(to.slice(6, 8)),
    );
    return Math.max(0, Math.round((t - f) / 86_400_000));
  }

  private toCreateInput(
    corpCode: string,
    stockCode: string,
    bar: SyntheticBar,
  ): Prisma.SimulatedDailyPriceCreateManyInput {
    return {
      corpCode,
      stockCode,
      tradeDate: bar.tradeDate,
      openPrice: bar.openPrice,
      highPrice: bar.highPrice,
      lowPrice: bar.lowPrice,
      closePrice: bar.closePrice,
      volume: BigInt(bar.volume),
      source: 'SYNTHETIC',
    };
  }

  /**
   * 합성 적재 대상 종목 — 보유 OPEN 포지션 + 진입 후보(entryReady·자격등급) 종목 합집합.
   * 종목코드 보유 종목만(합성도 stockCode 기반). 중복 제거.
   */
  private async resolveUniverse(
    portfolioId: string,
  ): Promise<Array<{ corpCode: string; stockCode: string }>> {
    const open = await this.prisma.position.findMany({
      where: { portfolioId, status: 'OPEN' },
      select: { corpCode: true, stockCode: true },
    });

    const rawSignals = await this.prisma.tradingSignal.findMany({
      where: {
        signal: { in: entryEligibleGrades(SIM_MIN_ENTRY_GRADE) as never },
        entryReady: true,
      },
      orderBy: { buyScore: 'desc' },
      take: CANDIDATE_UNIVERSE_CAP,
      select: { id: true, corpCode: true, stockCode: true, buyScore: true, signal: true },
    });
    const candidates = dedupeCandidatesByCorpCode(rawSignals);

    const byStock = new Map<string, { corpCode: string; stockCode: string }>();
    for (const r of [...open, ...candidates]) {
      if (!r.stockCode) continue;
      if (!byStock.has(r.stockCode)) {
        byStock.set(r.stockCode, { corpCode: r.corpCode, stockCode: r.stockCode });
      }
    }
    return [...byStock.values()];
  }
}
