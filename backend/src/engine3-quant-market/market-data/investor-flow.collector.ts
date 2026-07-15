import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { KST_TIMEZONE, formatKstDateCompact } from '../../common/time/kst';
import { isWeekendDate } from '../../common/time/market-calendar';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS, CronJobKey } from '../../cron-health/cron-health.jobs';
import { KrxInvestorFlowSource } from './krx-investor-flow.source';
import { KisInvestorFlowSource } from './kis-investor-flow.source';
import {
  InvestorFlowBar,
  InvestorFlowSource,
  ShortSellingBar,
  computeShortBalancePublishedDate,
} from './investor-flow-source';

/**
 * InvestorFlowCollector — 수급(투자자별 매매동향)·공매도 EOD 수집기 (갭분석 W16).
 *
 * 외국인/기관/개인 순매수(InvestorFlowDaily)와 공매도 일별(ShortSellingDaily)을 장 마감 후
 * EOD 로 적재한다. '무공시 급등락' 원인 설명(W6)·롱텀 백테스트 공변량의 데이터 축 — 수집
 * 시계가 곧 임계 경로라 즉시 축적을 시작한다.
 *
 *   - 소스 체인 = KRX 1차 → KIS 폴백(투자자별 상품이 KRX 오픈API 에 부재(404 실검증)라 실질
 *     1차는 KIS — krx-investor-flow.source.ts 참조). 어느 어댑터가 적재했는지 source 컬럼 기록.
 *   - 유니버스 = 기존 KRX 일봉 수집과 동일 대상(Company.stockCode 보유 전 종목).
 *   - 멱등: createMany skipDuplicates + '이미 target 일자 적재된 종목 스킵'(done-set) —
 *     재시도/아침 슬롯 재발화는 잔여 종목만 재시도(레이트리밋 절약).
 *   - 공매도 잔고 publishedDate = T+2 영업일(computeShortBalancePublishedDate) — lookahead 불가침.
 *   - Cron 슬롯(기존 일봉 수집 슬롯 패턴 대칭): 평일 20:00 저녁 정시 + 21:30 재시도 +
 *     07:40 아침 백스톱(밤사이 확정분 확보 — 08:00 일봉/지수 슬롯과 시간대 분리).
 *   - CronRunLog job key 2본(INVESTOR_FLOW_COLLECT·SHORT_SELLING_COLLECT) — krx.daily 거짓
 *     stale 선례 재발 방지(옵스 표면 필수).
 *
 * ★graceful: 가용 소스 없음(키 미설정)이면 no-op(실호출 0). ★throw 금지(cron 스케줄 유지).
 * ★SHADOW 불가침: 조회·표면 계층 전용 — Buy Score·트레이딩 경로에 입력하지 않는다(점수화
 *   자체를 하지 않음). M10 모의운용 무오염.
 * AI 금지영역: 순수 HTTP/적재. 점수·체결·하드룰과 무관(읽기 전용 데이터층).
 */

/** 종목당 소급 조회 구간(달력일) — 주말·연휴 공백 흡수. env INVESTOR_FLOW_LOOKBACK_DAYS 로 조정. */
export const INVESTOR_FLOW_LOOKBACK_DEFAULT_DAYS = 14;

/** 1회 수집 종목 상한(레이트리밋 가드) — env INVESTOR_FLOW_COLLECT_CAP 로 조정. */
export const INVESTOR_FLOW_COLLECT_CAP_DEFAULT = 3_000;

/** 1회 수집 커버리지(정직 보고). */
export interface InvestorFlowCollectResult {
  /** 수집 목표 거래일(YYYYMMDD — 일봉 spine 최신일). */
  targetDate: string;
  /** 실제 사용한 소스('KIS' 등). 가용 소스 없으면 null. */
  source: string | null;
  /** 유니버스 종목 수(일봉 수집과 동일 대상). */
  universeSize: number;
  /** target 일자 기준 미적재였던(이번에 시도한) 종목 수. */
  attempted: number;
  /** 1행 이상 받은 종목 수. */
  covered: number;
  /** 0행이던 종목 수(신규상장·거래정지·소스 미게시). */
  empty: number;
  /** 신규 적재 행 수(멱등 — 기존 행 제외). */
  rowsSaved: number;
  message?: string;
}

type FlowKind = 'investorFlow' | 'shortSelling';

@Injectable()
export class InvestorFlowCollector {
  private readonly logger = new Logger(InvestorFlowCollector.name);

  /** 단일 실행 락 — 슬롯 겹침으로 레이트리밋·중복부하 내지 않도록. */
  private isCollecting = false;

  /** 소스 우선순위 체인 — KRX 1차, KIS 폴백(W16 스펙). isAvailable/0행 시 다음 소스로. */
  private readonly sources: InvestorFlowSource[];

  constructor(
    private readonly prisma: PrismaService,
    krxSource: KrxInvestorFlowSource,
    kisSource: KisInvestorFlowSource,
    // @Global CronHealthModule 제공 — 미주입(테스트 등) 시 graceful 생략.
    @Optional() private readonly cronRunRecorder?: CronRunRecorderService,
  ) {
    this.sources = [krxSource, kisSource];
  }

  /** 평일 20:00(KST) — 수급·공매도 EOD 정시 수집(19:00~19:50 신호/모의운용 대열과 시간대 분리). */
  @Cron('0 20 * * 1-5', { timeZone: KST_TIMEZONE })
  async eveningCollectCron() {
    return this.runBothWithHealth();
  }

  /**
   * 평일 21:30(KST) — EOD 재시도 슬롯. 20:00 시점 소스 미게시로 0행이던 종목(done-set 미포함)
   * 만 동일 멱등 경로로 재시도한다(일봉 21:00 재시도 슬롯 대칭 — DAR-438 근거 동일).
   */
  @Cron('30 21 * * 1-5', { timeZone: KST_TIMEZONE })
  async retryCollectCron() {
    return this.runBothWithHealth();
  }

  /**
   * 평일 07:40(KST) — 아침 백스톱 슬롯. 밤사이 확정된 전일분을 개장 전에 확보한다
   * (일봉 06:30/08:00 아침 슬롯 대칭 — KRX/KIS EOD 지연 게시 대응). 08:00 일봉·지수·ETF
   * 슬롯과 시간대를 분리해 KIS 유량 경합을 피한다. 이미 적재됐으면 done-set no-op.
   */
  @Cron('40 7 * * 1-5', { timeZone: KST_TIMEZONE })
  async morningBackstopCollectCron() {
    return this.runBothWithHealth();
  }

  /**
   * 수급→공매도 순차 수집을 cron-health(CronRunLog) 래핑으로 실행. 두 잡 키를 분리 기록해
   * 각각의 신선도가 독립 감시된다. 한 축 실패가 다른 축을 막지 않도록 축별로 흡수한다.
   */
  private async runBothWithHealth(): Promise<{
    investorFlow: InvestorFlowCollectResult | { skipped: true };
    shortSelling: InvestorFlowCollectResult | { skipped: true };
  }> {
    if (this.isCollecting) {
      this.logger.warn('[수급] 이전 수집 진행 중 — 이번 회차 건너뜀(겹침·레이트리밋 방지)');
      return { investorFlow: { skipped: true }, shortSelling: { skipped: true } };
    }
    this.isCollecting = true;
    try {
      const investorFlow = await this.recordSafely(
        CRON_JOB_KEYS.INVESTOR_FLOW_COLLECT,
        () => this.collectInvestorFlowOnce(),
      );
      const shortSelling = await this.recordSafely(
        CRON_JOB_KEYS.SHORT_SELLING_COLLECT,
        () => this.collectShortSellingOnce(),
      );
      return { investorFlow, shortSelling };
    } finally {
      this.isCollecting = false;
    }
  }

  /** recorder 래핑 + 예외 흡수(cron 스케줄 유지 — recorder 가 FAILED 기록 후 재던진 예외 포함). */
  private async recordSafely(
    jobKey: CronJobKey,
    run: () => Promise<InvestorFlowCollectResult>,
  ): Promise<InvestorFlowCollectResult | { skipped: true }> {
    try {
      if (!this.cronRunRecorder) return await run();
      return await this.cronRunRecorder.record(jobKey, run, {
        countOf: (r) => r.rowsSaved,
      });
    } catch (e) {
      this.logger.error(`[수급] ${jobKey} 수집 오류: ${(e as Error).message}`);
      return { skipped: true };
    }
  }

  /**
   * 투자자별 매매동향 1회 수집(수동/cron 공용). target 일자 미적재 종목만 소스 체인으로
   * 조회해 InvestorFlowDaily 에 멱등 적재한다.
   *
   * @param opts.now       기준 시각(테스트 주입)
   * @param opts.codes     유니버스 강제(테스트/부분수집 — 미지정 시 Company.stockCode 전 종목)
   * @param opts.cap       종목 상한(미지정 시 env → 기본 3000)
   * @param opts.delayMs   종목 호출 간 지연 ms(레이트리밋 스로틀, 기본 120)
   * @param opts.sleep     지연 주입(테스트용)
   */
  async collectInvestorFlowOnce(
    opts: {
      now?: Date;
      codes?: readonly string[];
      cap?: number;
      delayMs?: number;
      sleep?: (ms: number) => Promise<void>;
    } = {},
  ): Promise<InvestorFlowCollectResult> {
    return this.collectOnce('investorFlow', opts);
  }

  /**
   * 공매도 일별 1회 수집(수동/cron 공용). ShortSellingDaily 에 멱등 적재 — 각 행의
   * publishedDate 는 T+2 영업일(lookahead 불가침), 잔고 필드는 소스 미가용 시 null(정직).
   */
  async collectShortSellingOnce(
    opts: {
      now?: Date;
      codes?: readonly string[];
      cap?: number;
      delayMs?: number;
      sleep?: (ms: number) => Promise<void>;
    } = {},
  ): Promise<InvestorFlowCollectResult> {
    return this.collectOnce('shortSelling', opts);
  }

  private async collectOnce(
    kind: FlowKind,
    opts: {
      now?: Date;
      codes?: readonly string[];
      cap?: number;
      delayMs?: number;
      sleep?: (ms: number) => Promise<void>;
    },
  ): Promise<InvestorFlowCollectResult> {
    const now = opts.now ?? new Date();
    const delayMs = opts.delayMs ?? 120;
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const cap = opts.cap ?? this.resolveCap();
    const label = kind === 'investorFlow' ? '투자자수급' : '공매도';

    const targetDate = await this.resolveTargetDate(now);
    const startYmd = this.minusCalendarDays(targetDate, this.resolveLookbackDays());

    const activeSources = this.sources.filter((s) => s.isAvailable());
    if (activeSources.length === 0) {
      return {
        targetDate,
        source: null,
        universeSize: 0,
        attempted: 0,
        covered: 0,
        empty: 0,
        rowsSaved: 0,
        message: `가용 소스 없음(KRX 상품 부재·KIS 키 미설정) — ${label} 수집 스킵`,
      };
    }

    const universe = opts.codes ?? (await this.loadUniverseStockCodes());
    const doneSet = await this.loadDoneSet(kind, targetDate);
    const pending = universe.filter((c) => !doneSet.has(c)).slice(0, cap);

    if (pending.length === 0) {
      this.logger.log(`[수급] ${label} — target=${targetDate} 전 종목 적재 완료(no-op)`);
      return {
        targetDate,
        source: activeSources[0].sourceName,
        universeSize: universe.length,
        attempted: 0,
        covered: 0,
        empty: 0,
        rowsSaved: 0,
      };
    }

    this.logger.log(
      `[수급] ${label} 수집 시작 target=${targetDate} 구간=${startYmd}~${targetDate} ` +
        `대상=${pending.length}/${universe.length}종 소스체인=[${activeSources
          .map((s) => s.sourceName)
          .join('→')}]`,
    );

    let covered = 0;
    let empty = 0;
    let rowsSaved = 0;
    let usedSource: string | null = null;

    for (let i = 0; i < pending.length; i++) {
      const stockCode = pending[i];
      const { bars, sourceName } = await this.fetchWithFallback(kind, activeSources, stockCode, {
        startYmd,
        endYmd: targetDate,
        nowMs: now.getTime(),
      });
      if (bars.length > 0) {
        covered++;
        usedSource = usedSource ?? sourceName;
        rowsSaved +=
          kind === 'investorFlow'
            ? await this.persistInvestorFlow(stockCode, bars as InvestorFlowBar[], sourceName!)
            : await this.persistShortSelling(stockCode, bars as ShortSellingBar[], sourceName!);
      } else {
        empty++;
      }
      if (i < pending.length - 1 && delayMs > 0) await sleep(delayMs);
    }

    this.logger.log(
      `[수급] ${label} 수집 완료 target=${targetDate} 커버=${covered}/${pending.length} ` +
        `(빈종목=${empty}) 신규적재=${rowsSaved}행 소스=${usedSource ?? '-'}`,
    );

    return {
      targetDate,
      source: usedSource ?? activeSources[0].sourceName,
      universeSize: universe.length,
      attempted: pending.length,
      covered,
      empty,
      rowsSaved,
    };
  }

  /**
   * 소스 체인 폴백 조회 — 우선순위 순회하며 1행 이상 주는 첫 소스를 채택한다.
   * 개별 소스 오류는 다음 소스로 폴백(graceful) — 전 소스 실패 시 빈 배열.
   */
  private async fetchWithFallback(
    kind: FlowKind,
    activeSources: InvestorFlowSource[],
    stockCode: string,
    fetchOpts: { startYmd: string; endYmd: string; nowMs?: number },
  ): Promise<{ bars: InvestorFlowBar[] | ShortSellingBar[]; sourceName: string | null }> {
    for (const source of activeSources) {
      try {
        const bars =
          kind === 'investorFlow'
            ? await source.fetchInvestorFlow(stockCode, fetchOpts)
            : await source.fetchShortSelling(stockCode, fetchOpts);
        if (bars.length > 0) return { bars, sourceName: source.sourceName };
      } catch (e) {
        this.logger.warn(
          `[수급] ${source.sourceName} ${kind} 조회 실패 ${stockCode}: ${(e as Error).message} — 다음 소스로 폴백`,
        );
      }
    }
    return { bars: [], sourceName: null };
  }

  /** InvestorFlowDaily 멱등 적재(createMany skipDuplicates). 반환=신규 삽입 행수. */
  private async persistInvestorFlow(
    stockCode: string,
    bars: InvestorFlowBar[],
    source: string,
  ): Promise<number> {
    const data: Prisma.InvestorFlowDailyCreateManyInput[] = bars
      .filter((b) => /^\d{8}$/.test(b.tradeDate))
      .map((b) => ({
        stockCode,
        tradeDate: b.tradeDate,
        foreignNetBuyQty: BigInt(Math.round(b.foreignNetBuyQty)),
        foreignNetBuyAmount: BigInt(Math.round(b.foreignNetBuyAmount)),
        institutionNetBuyQty: BigInt(Math.round(b.institutionNetBuyQty)),
        institutionNetBuyAmount: BigInt(Math.round(b.institutionNetBuyAmount)),
        individualNetBuyQty: BigInt(Math.round(b.individualNetBuyQty)),
        individualNetBuyAmount: BigInt(Math.round(b.individualNetBuyAmount)),
        source,
      }));
    if (data.length === 0) return 0;
    const result = await this.prisma.investorFlowDaily.createMany({ data, skipDuplicates: true });
    return result.count;
  }

  /**
   * ShortSellingDaily 멱등 적재. publishedDate = T+2 영업일(lookahead 불가침 — as-of 조회는
   * publishedDate ≤ 기준일 강제). 잔고 필드는 소스 미가용 시 null(합성 금지).
   */
  private async persistShortSelling(
    stockCode: string,
    bars: ShortSellingBar[],
    source: string,
  ): Promise<number> {
    const data: Prisma.ShortSellingDailyCreateManyInput[] = bars
      .filter((b) => /^\d{8}$/.test(b.tradeDate))
      .map((b) => ({
        stockCode,
        tradeDate: b.tradeDate,
        shortSellingVolume: BigInt(Math.max(0, Math.round(b.shortSellingVolume))),
        shortSellingAmount:
          b.shortSellingAmount != null ? BigInt(Math.max(0, Math.round(b.shortSellingAmount))) : null,
        shortBalanceQty: b.shortBalanceQty != null ? BigInt(Math.round(b.shortBalanceQty)) : null,
        shortBalanceRatio: b.shortBalanceRatio,
        publishedDate: computeShortBalancePublishedDate(b.tradeDate),
        source,
      }));
    if (data.length === 0) return 0;
    const result = await this.prisma.shortSellingDaily.createMany({ data, skipDuplicates: true });
    return result.count;
  }

  /**
   * 수집 목표 거래일 해석 — 일봉 spine(StockDailyPrice 최신 tradeDate)을 따른다.
   * 수급 데이터는 일봉과 동일 게시 리듬(EOD)이고 유니버스도 동일하므로, 일봉이 확보한 최신
   * 거래일이 곧 수급의 목표일이다(별도 프로브 불필요 — 일봉 크론이 이미 KRX 프로브 수행).
   * 저장소 부트스트랩(일봉 0행) 시 KST 오늘을 직전 평일로 클램프해 사용.
   */
  private async resolveTargetDate(now: Date): Promise<string> {
    const latest = await this.prisma.stockDailyPrice.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    });
    if (latest?.tradeDate) return latest.tradeDate;
    const d = new Date(now);
    while (isWeekendDate(d)) d.setDate(d.getDate() - 1);
    return formatKstDateCompact(d);
  }

  /** 유니버스 — 기존 KRX 일봉 수집과 동일 대상(Company.stockCode 보유 전 종목). */
  private async loadUniverseStockCodes(): Promise<string[]> {
    const companies = await this.prisma.company.findMany({
      where: { stockCode: { not: null } },
      select: { stockCode: true },
    });
    return companies
      .map((c) => c.stockCode)
      .filter((c): c is string => c !== null && /^\d{6}$/.test(c));
  }

  /** target 일자에 이미 적재된 종목 집합 — 재시도/아침 슬롯이 잔여 종목만 재시도하게 한다. */
  private async loadDoneSet(kind: FlowKind, targetDate: string): Promise<Set<string>> {
    const rows =
      kind === 'investorFlow'
        ? await this.prisma.investorFlowDaily.findMany({
            where: { tradeDate: targetDate },
            select: { stockCode: true },
          })
        : await this.prisma.shortSellingDaily.findMany({
            where: { tradeDate: targetDate },
            select: { stockCode: true },
          });
    return new Set(rows.map((r) => r.stockCode));
  }

  /** YYYYMMDD 에서 달력일 days 를 뺀 YYYYMMDD (UTC 산술 — TZ 무관). */
  private minusCalendarDays(ymd: string, days: number): string {
    const d = new Date(
      Date.UTC(
        parseInt(ymd.slice(0, 4), 10),
        parseInt(ymd.slice(4, 6), 10) - 1,
        parseInt(ymd.slice(6, 8), 10),
      ),
    );
    d.setUTCDate(d.getUTCDate() - days);
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    return `${d.getUTCFullYear()}${mm}${dd}`;
  }

  private resolveLookbackDays(): number {
    const raw = process.env.INVESTOR_FLOW_LOOKBACK_DAYS;
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : INVESTOR_FLOW_LOOKBACK_DEFAULT_DAYS;
  }

  private resolveCap(): number {
    const raw = process.env.INVESTOR_FLOW_COLLECT_CAP;
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : INVESTOR_FLOW_COLLECT_CAP_DEFAULT;
  }
}
