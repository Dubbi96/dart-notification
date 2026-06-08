/**
 * SimulationPriceSourceService — 모의운용 시세 소스 추상화 (DAR-124 · DAR-137)
 *
 * 모의운용이 읽는 일봉 소스를 한 곳으로 모은다. 세 모드:
 *   - REAL(기본): StockDailyPrice(실 KRX 일봉)만 읽는다. 회귀 0.
 *   - SYNTHETIC(PAPER_SIM_SYNTHETIC_FEED=1): SimulatedDailyPrice(결정적 합성 일봉)만 읽는다.
 *     환경 시계가 미래(2026)라 실 KRX 일봉이 없을 때 30일 트랙레코드가 의미를 갖게 한다(DAR-124).
 *   - REAL_THEN_SYNTHETIC(PAPER_SIM_REAL_FEED=1, DAR-137): 종목 단위로 실가격 우선,
 *     실데이터가 없는 종목만 합성으로 폴백. 보유/후보 종목에 실 KRX 시계열을 적재해두면
 *     진입/Exit/스냅샷/스코어가 '실가 변동'을 평가하고, 데이터 공백 종목만 합성으로 트랙을 잇는다.
 *
 * ★신뢰 원칙(불가침): 합성 가격은 '모의/시뮬레이션' 전용이다. 실시세로 표시하지 않으며
 *   실데이터와 혼합하지 않는다. 한 종목은 한 소스로만 평가된다(행 단위 혼합 금지) — 실데이터가
 *   있는 종목은 처음부터 끝까지 실가, 없는 종목은 합성. 각 행은 source('REAL'|'SYNTHETIC')로
 *   라벨되어 소비자가 정직하게 구분 표기한다. 합성 가격은 이 서비스를 통해 PaperSimulation 만
 *   소비한다 — 기업 현재가/지표/신호 등 실가격 경로는 미참조.
 *
 * ★정직(DAR-137): 실 KRX 일봉은 환경 시계(2026)가 아니라 '최신 가용 실데이터' 기준이다.
 *   실가는 실제 거래일 종가지만 날짜축은 과거일 수 있다 — 2026 실시세로 오인 금지.
 *
 * AI 금지영역: 가격 생성은 순수 시드 PRNG(Rule). 체결·주문수량·하드룰과 무관.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
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
import { mapSimDateToRealDate, realYearShift } from './real-date-map';
import { RealtimeQuoteCache } from '../../engine3-quant-market/market-data/realtime-quote.cache';

/** 일봉/현재가 1행의 출처 — 정직한 실시간/실데이터/합성 구분 표기용.
 *  REALTIME=KIS 실시간 현재가(DAR-140) · REAL=실 KRX 일봉 · SYNTHETIC=합성. */
export type SimPriceSource = 'REALTIME' | 'REAL' | 'SYNTHETIC';

/** 모의운용 시세 소스 모드(런 단위). REAL=실데이터만, SYNTHETIC=합성만,
 *  REAL_THEN_SYNTHETIC=종목 단위 실가 우선·합성 폴백(DAR-137). */
export type SimPriceMode = 'REAL' | 'SYNTHETIC' | 'REAL_THEN_SYNTHETIC';

/** 모의운용이 소비하는 일봉 1행(소스 무관 공통 형태). volume 은 스냅샷 BigInt 컬럼 정합.
 *  source 는 이 행이 실데이터인지 합성인지 — 소비자가 정직하게 라벨하도록 동반한다. */
export interface SimPriceRow {
  openPrice: number;
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  volume: bigint;
  source: SimPriceSource;
  /** DAR-137: 이 행이 실제로 가져온 거래일(YYYYMMDD). REAL_THEN_SYNTHETIC 매핑 모드에서는
   *  시뮬 날짜가 아니라 '매핑된 실 거래일' — 2026 오인 방지·정직 고지(원일자)용. */
  sourceDate?: string;
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

  constructor(
    private readonly prisma: PrismaService,
    // DAR-140: KIS 실시간 현재가 캐시(@Global). 미주입/미설정이면 실시간 비활성(일봉/합성 폴백·회귀 0).
    @Optional() private readonly realtimeCache?: RealtimeQuoteCache,
  ) {}

  /**
   * 시세 소스 모드 — 환경 플래그로 결정(런 단위, 우선순위 명시).
   *   PAPER_SIM_REAL_FEED 우선 → REAL_THEN_SYNTHETIC(실가 우선·합성 폴백, DAR-137)
   *   그다음 PAPER_SIM_SYNTHETIC_FEED → SYNTHETIC(합성 전용, DAR-124)
   *   둘 다 미설정 → REAL(실데이터 전용, 기본·회귀 0)
   */
  get mode(): SimPriceMode {
    if (SimulationPriceSourceService.flagOn(process.env.PAPER_SIM_REAL_FEED)) {
      return 'REAL_THEN_SYNTHETIC';
    }
    if (SimulationPriceSourceService.flagOn(process.env.PAPER_SIM_SYNTHETIC_FEED)) {
      return 'SYNTHETIC';
    }
    return 'REAL';
  }

  /** 합성 전용 모드 여부(DAR-124 가드 호환). 하이브리드는 false — 실가가 주 소스이므로
   *  합성 전용 후처리(레거시 재기준)는 적용하지 않는다. */
  get isSynthetic(): boolean {
    return this.mode === 'SYNTHETIC';
  }

  /** 합성 일봉을 적재(시드)해야 하는 모드 여부 — SYNTHETIC + 하이브리드 폴백분. */
  get seedsSynthetic(): boolean {
    return this.mode !== 'REAL';
  }

  /** 정직 표기용 한국어 모드 라벨(로그·운영 노출). */
  get modeLabel(): string {
    switch (this.mode) {
      case 'SYNTHETIC':
        return '합성(모의 전용)';
      case 'REAL_THEN_SYNTHETIC':
        return '실가 우선·합성 폴백(최신 가용 실데이터 기준)';
      default:
        return '실데이터(최신 가용 실 KRX 일봉)';
    }
  }

  private static flagOn(v: string | undefined): boolean {
    const s = (v ?? '').toLowerCase();
    return s === '1' || s === 'true' || s === 'on';
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
    // REAL 전용 모드는 합성 적재 불필요(no-op). SYNTHETIC·하이브리드는 합성 폴백분을 시드한다.
    if (!this.seedsSynthetic) return { stocks: 0, inserted: 0 };

    const stocks = await this.resolveUniverse(portfolioId);
    if (stocks.length === 0) return { stocks: 0, inserted: 0 };

    const dates = this.persistDates(tradeDate);
    if (dates.length === 0) return { stocks: stocks.length, inserted: 0 };

    let inserted = 0;
    let skippedReal = 0;
    for (const s of stocks) {
      // ★DAR-139: 하이브리드 모드에서 실데이터 보유 종목은 합성을 적재하지 않는다 — 평가에서
      //   합성을 절대 쓰지 않으므로(resolveSource→REAL) 적재는 불필요할 뿐 아니라, 'SimulatedDailyPrice는
      //   실데이터 없는 종목만' 원칙을 적재 단계에서도 지켜 합성/실 혼재를 원천 차단한다.
      if (this.mode === 'REAL_THEN_SYNTHETIC') {
        const src = await this.resolveSource(s.corpCode, tradeDate);
        if (src === 'REAL') {
          skippedReal++;
          continue;
        }
      }
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
      `[SimPriceSource][${this.modeLabel}] 유니버스 준비 stocks=${stocks.length} inserted=${inserted} 실데이터스킵=${skippedReal} tradeDate=${tradeDate}`,
    );
    return { stocks: stocks.length, inserted };
  }

  /**
   * tradeDate 이하의 가장 최신 일봉 1행(소스 모드별). 없으면 null.
   * 반환 행에는 source('REALTIME'|'REAL'|'SYNTHETIC') 가 라벨된다 — 정직 구분 표기용.
   *
   * 우선순위(DAR-140): 신선한 실시간 현재가 > 실 일봉(REAL) > 합성(SYNTHETIC).
   *   ★실시간은 SYNTHETIC 전용 모드에서는 미적용(순수 합성 트랙 보존). REAL/하이브리드에서만 우선.
   */
  async latestPriceRow(corpCode: string, tradeDate: string): Promise<SimPriceRow | null> {
    // DAR-140: 실시간 우선 — SYNTHETIC 전용 모드가 아니고, 신선한 실시간 현재가가 있으면 그것으로 평가.
    if (this.mode !== 'SYNTHETIC') {
      const rt = this.realtimeRowFor(corpCode);
      if (rt) return rt;
    }

    const src = await this.resolveSource(corpCode, tradeDate);
    if (src === 'SYNTHETIC') {
      // 합성은 시뮬 캘린더(2026)에 적재 — 매핑 없이 sim 날짜로 조회.
      const row = await this.prisma.simulatedDailyPrice.findFirst({
        where: { corpCode, tradeDate: { lte: tradeDate } },
        orderBy: { tradeDate: 'desc' },
        select: { ...this.rowSelect, tradeDate: true },
      });
      if (!row) return null;
      const { tradeDate: rowDate, ...rest } = row;
      return { ...rest, source: 'SYNTHETIC', sourceDate: rowDate };
    }
    // 실데이터: REAL_THEN_SYNTHETIC 모드는 시뮬 날짜를 실 거래일로 매핑(일별 전진 = 실가 변동).
    //   매핑일 이하 최신 실 거래일 종가(공백일/주말은 lte 로 직전 거래일 종가 자동 사용).
    const realDate = this.realQueryDate(tradeDate);
    let row = await this.prisma.stockDailyPrice.findFirst({
      where: { corpCode, tradeDate: { lte: realDate } },
      orderBy: { tradeDate: 'desc' },
      select: { ...this.rowSelect, tradeDate: true },
    });
    if (!row) {
      // ★DAR-139: 매핑일이 보유 실데이터 최초일보다 과거 → 합성으로 떨어뜨리지 않고
      //   '최신 실 거래일 종가'로 평가(실데이터 종목은 항상 실가). 정직: sourceDate=실 원일자.
      //   상한은 매핑 전 시뮬 날짜(tradeDate) — 시뮬 '오늘' 이후의 실데이터는 보지 않는다(미래참조 금지).
      row = await this.prisma.stockDailyPrice.findFirst({
        where: { corpCode, tradeDate: { lte: tradeDate } },
        orderBy: { tradeDate: 'desc' },
        select: { ...this.rowSelect, tradeDate: true },
      });
    }
    if (!row) return null; // 실데이터 전무(resolveSource 가 이 경우 SYNTHETIC 라우팅하므로 사실상 미도달)
    const { tradeDate: rowDate, ...rest } = row;
    // sourceDate = 실제 사용한 실 거래일(원일자) — 2026 오인 방지 정직 고지.
    return { ...rest, source: 'REAL', sourceDate: rowDate };
  }

  /** afterTradeDate 초과 거래일의 종가 take 개(오름차순). Exit 정확도(D+3) 산출용.
   *  종목별 단일 소스(혼합 금지) — latestPriceRow 와 동일 기준일(afterTradeDate)로 소스 결정. */
  async closesAfter(
    corpCode: string,
    afterTradeDate: string,
    take: number,
  ): Promise<Array<{ closePrice: number }>> {
    const src = await this.resolveSource(corpCode, afterTradeDate);
    if (src === 'SYNTHETIC') {
      return this.prisma.simulatedDailyPrice.findMany({
        where: { corpCode, tradeDate: { gt: afterTradeDate } },
        orderBy: { tradeDate: 'asc' },
        select: { closePrice: true },
        take,
      });
    }
    // 실데이터: 하한도 매핑(시뮬 날짜 전진 → 매핑 실날짜 전진 → 후속 실 종가 D+N).
    const afterReal = this.realQueryDate(afterTradeDate);
    return this.prisma.stockDailyPrice.findMany({
      where: { corpCode, tradeDate: { gt: afterReal } },
      orderBy: { tradeDate: 'asc' },
      select: { closePrice: true },
      take,
    });
  }

  /**
   * 한 종목이 어느 소스로 평가될지 결정(종목 단위 단일 소스 — 행 혼합 금지).
   *   - REAL: 항상 실데이터(StockDailyPrice). 조회 없음(회귀 0).
   *   - SYNTHETIC: 항상 합성(SimulatedDailyPrice). 조회 없음.
   *   - REAL_THEN_SYNTHETIC(DAR-137·DAR-139): 종목이 시뮬 날짜 이하 실 일봉을 '하나라도' 보유하면 REAL.
   *     ★DAR-139: 보유 판정을 '매핑일(2025) 기준 lte' 가 아니라 '시뮬 날짜(asOf, 미매핑) 이하 존재'로
   *     한다. 매핑일이 보유 실데이터 최초일보다 과거여도(공백일·윈도 밖) 실데이터 종목은 합성으로
   *     떨어지지 않고 최신 실 거래일 종가로 평가된다(latestPriceRow 폴백). 실데이터 전무 종목만
   *     SYNTHETIC. ★상한은 미매핑 asOf — 시뮬 '오늘' 이후 실데이터는 보유 판정에서 제외(미래참조 금지).
   */
  private async resolveSource(corpCode: string, asOf: string): Promise<SimPriceSource> {
    const m = this.mode;
    if (m === 'REAL') return 'REAL';
    if (m === 'SYNTHETIC') return 'SYNTHETIC';
    const real = await this.prisma.stockDailyPrice.findFirst({
      where: { corpCode, tradeDate: { lte: asOf } },
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    });
    return real ? 'REAL' : 'SYNTHETIC';
  }

  /**
   * REAL_THEN_SYNTHETIC 모드에서 시뮬 거래일을 실데이터 조회 거래일로 환산한다(DAR-137·DAR-139).
   *   - 연도 시프트는 '옵트인'(realYearShift): PAPER_SIM_REAL_YEAR_OFFSET 명시(≥1) 시에만 N년 시프트
   *     (과거 데이터만 보유한 환경의 리플레이). 미설정(기본)이면 시프트 0 → 시뮬 날짜 그대로 사용 →
   *     실데이터를 최신 실 거래일 종가로 평가(DAR-139 DoD: 실데이터 보유 종목 = 최신 실가).
   *   - 그 외 모드(REAL 기본·SYNTHETIC)는 입력 거래일을 그대로 사용 → 기존 동작 보존(회귀 0).
   */
  private realQueryDate(date: string): string {
    if (this.mode !== 'REAL_THEN_SYNTHETIC') return date;
    const shift = realYearShift();
    return shift >= 1 ? mapSimDateToRealDate(date, shift) : date;
  }

  /**
   * DAR-140: 신선한 KIS 실시간 현재가를 SimPriceRow(source=REALTIME)로 변환. 없으면 null.
   *   캐시 미주입(@Optional)·미설정·stale 이면 null → 호출측이 일봉/합성으로 폴백.
   *   sourceDate = 실 wall-clock 날짜(원일자) — 환경 시계(2026)와 다를 수 있음을 정직 고지.
   */
  private realtimeRowFor(corpCode: string): SimPriceRow | null {
    const q = this.realtimeCache?.getFresh(corpCode);
    if (!q || q.price <= 0) return null;
    return {
      openPrice: q.open > 0 ? q.open : q.price,
      highPrice: q.high > 0 ? q.high : q.price,
      lowPrice: q.low > 0 ? q.low : q.price,
      closePrice: q.price,
      volume: BigInt(Math.max(0, q.volume)),
      source: 'REALTIME',
      sourceDate: this.msToYmd(q.fetchedAtMs),
    };
  }

  /** epoch ms → YYYYMMDD(UTC). 실시간 원일자 정직 고지용. */
  private msToYmd(ms: number): string {
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}${m}${day}`;
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
   * 모의운용 시세 유니버스 — 보유 OPEN 포지션 + 진입 후보 종목(공개 래퍼).
   * 실 KRX 일봉 적재 대상/커버리지 점검에 외부(수동 스크립트)에서 재사용한다.
   * portfolioId 미지정 시 전체 SIM 포트폴리오의 OPEN 포지션을 대상으로 한다.
   */
  async resolveSimUniverse(
    portfolioId?: string,
  ): Promise<Array<{ corpCode: string; stockCode: string }>> {
    return this.resolveUniverse(portfolioId);
  }

  /**
   * 모의 유니버스의 실 KRX 일봉 커버리지 점검(DAR-137 적재 검증·정직 고지용).
   * asOf 이하 실데이터가 있는 종목 수/없는 종목 목록과, 전체에서 가장 최신 실데이터 거래일을 집계한다.
   * ★latestRealDate 는 '최신 가용 실데이터' 기준 — 환경 시계(2026)와 다를 수 있다(2026 실시세 오인 금지).
   */
  async realCoverage(
    asOf: string,
    portfolioId?: string,
  ): Promise<{
    total: number;
    covered: number;
    uncovered: Array<{ corpCode: string; stockCode: string }>;
    latestRealDate: string | null;
  }> {
    const universe = await this.resolveUniverse(portfolioId);
    const uncovered: Array<{ corpCode: string; stockCode: string }> = [];
    let covered = 0;
    let latestRealDate: string | null = null;
    for (const s of universe) {
      const row = await this.prisma.stockDailyPrice.findFirst({
        where: { corpCode: s.corpCode, tradeDate: { lte: asOf } },
        orderBy: { tradeDate: 'desc' },
        select: { tradeDate: true },
      });
      if (row) {
        covered++;
        if (latestRealDate === null || row.tradeDate > latestRealDate) {
          latestRealDate = row.tradeDate;
        }
      } else {
        uncovered.push(s);
      }
    }
    return { total: universe.length, covered, uncovered, latestRealDate };
  }

  /**
   * 합성 적재 대상 종목 — 보유 OPEN 포지션 + 진입 후보(entryReady·자격등급) 종목 합집합.
   * 종목코드 보유 종목만(합성도 stockCode 기반). 중복 제거.
   */
  private async resolveUniverse(
    portfolioId?: string,
  ): Promise<Array<{ corpCode: string; stockCode: string }>> {
    const open = await this.prisma.position.findMany({
      where: { status: 'OPEN', ...(portfolioId ? { portfolioId } : {}) },
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
