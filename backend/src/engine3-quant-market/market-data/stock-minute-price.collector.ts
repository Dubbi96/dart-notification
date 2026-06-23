import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { KisApiService, KisMinuteCandle } from './kis-api.service';
import { KrxMarketDataScheduler } from './krx-market-data.scheduler';
import { KST_TIMEZONE, isKstRegularMarketHours } from '../../common/time/kst';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';
import { minuteTimestamp } from './minute-timestamp';

/**
 * StockMinutePriceCollector — KIS 당일 분봉을 StockMinutePrice 에 forward 축적 (DAR-377).
 *
 * ★KIS 는 '당일 분봉'만 제공한다(과거 분봉 미제공). 따라서 분봉은 과거 소급 백필이 불가능하며,
 *   수집 시작일부터 매일 수집해 누적한다. 이 정직 고지(forward-only)는 docs·수집 로그에도 명시한다.
 *
 * 수집 전략(레이트리밋·일일 쿼터 엄수):
 *   - 정규장(평일 09:00~15:30 KST) 내 10분 간격 cron 으로 가동. 각 호출은 우선순위 상위 종목의
 *     당일 분봉(전 구간)을 KIS 에서 받아 멱등 적재(createMany skipDuplicates). 10분 간격 반복으로
 *     장 마감 시점이면 커버 종목의 당일 세션 전체가 누적된다.
 *   - 전 종목(수천)×당일 분봉은 KIS 일일 쿼터를 초과하므로, 우선순위(보유·관심·신호·거래량 상위)로
 *     상한(MINUTE_COLLECT_CAP)까지만 수집하고, 쿼터로 잘린 종목 수를 '커버리지 정직 로그'로 남긴다.
 *   - 종목 간 stockDelayMs·페이지 간 pageDelayMs 스로틀 + 단일 실행 락으로 초당 제한 위반을 0 으로.
 *
 * ★graceful: KIS 키 미설정(isConfigured=false)이면 즉시 no-op(실호출 0). ★throw 금지(cron 유지).
 * ★정직: 적재가는 실제 시장 실시간 분봉(REALTIME). 환경 시계(2026)와 시점 괴리는 tradeDate(KRX 실
 *   가용 거래일)·createdAt 로 드러난다. 합성(SYNTHETIC)과 혼동 금지.
 *
 * AI 금지영역: 순수 HTTP/적재. 점수·체결·하드룰과 무관(읽기 전용 시세 수집).
 */

/** 1회 수집 종목 상한(KIS 일일 쿼터·레이트리밋 가드). env KIS_MINUTE_COLLECT_CAP 로 조정 가능. */
export const MINUTE_COLLECT_DEFAULT_CAP = 100;

export interface MinuteCollectCoverage {
  /** 수집 기준 거래일(KRX 실 가용 거래일, YYYYMMDD). */
  tradeDate: string;
  /** 우선순위로 추린 전체 후보 종목 수(쿼터 적용 전). */
  totalCandidates: number;
  /** 쿼터(cap) 적용 후 실제 수집 시도한 종목 수. */
  requested: number;
  /** 쿼터로 잘려 이번 회차에 수집하지 못한 종목 수(정직 고지). */
  skippedByQuota: number;
  /** 당일 분봉을 1행 이상 받은(=커버된) 종목 수. */
  covered: number;
  /** 당일 분봉이 0행이던 종목 수(장 시작 직후·거래없음·실패). */
  empty: number;
  /** 신규로 적재된 분봉 행 수(멱등 — 이미 있던 행 제외). */
  candlesSaved: number;
  message?: string;
}

@Injectable()
export class StockMinutePriceCollector {
  private readonly logger = new Logger(StockMinutePriceCollector.name);

  /** 단일 실행 락 — 10분 간격 cron 이 직전 회차와 겹쳐 rate-limit 위반·중복부하 내지 않도록. */
  private isCollecting = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly kis: KisApiService,
    private readonly scheduler: KrxMarketDataScheduler,
    @Optional() private readonly cronRunRecorder?: CronRunRecorderService,
  ) {}

  /** 평일 09:00~15:30(정규장) 매 10분(KST) — 우선순위 상위 종목 당일 분봉 forward 수집. */
  @Cron('*/10 9-15 * * 1-5', { timeZone: KST_TIMEZONE })
  async collectMinutePricesCron(now: Date = new Date()): Promise<MinuteCollectCoverage | { skipped: true }> {
    // 정규장(09:00~15:30) 밖이면 스킵 — cron 의 '15시대'에 15:30 이후가 포함되므로 게이트로 정밀화.
    if (!isKstRegularMarketHours(now)) {
      return { skipped: true };
    }
    if (!this.kis.isConfigured) {
      // 키 미설정 — 분봉 수집 비활성. 기록 없이 no-op(미설정 환경 분단위 로그 폭주 방지).
      return { skipped: true };
    }
    if (this.isCollecting) {
      this.logger.warn('[분봉] 이전 수집 진행 중 — 이번 회차 건너뜀(겹침·rate-limit 방지)');
      return { skipped: true };
    }

    this.isCollecting = true;
    const run = () => this.collectOnce();
    try {
      if (!this.cronRunRecorder) return await run();
      // 마지막 성공시각/적재건수 기록(신선도 안전망 노출 + 실패 표면화).
      return await this.cronRunRecorder.record(CRON_JOB_KEYS.MINUTE_PRICE_COLLECT, run, {
        countOf: (r) => r.candlesSaved,
      });
    } catch (e) {
      // recorder 가 FAILED 기록 후 재던진 예외를 흡수해 cron 스케줄 유지.
      this.logger.error(`[분봉] 수집 오류: ${(e as Error).message}`);
      return { skipped: true };
    } finally {
      this.isCollecting = false;
    }
  }

  /**
   * 1회 분봉 수집 본체 (수동/cron 공용). 우선순위 상위 종목의 당일 분봉을 멱등 적재하고 커버리지를
   * 정직하게 보고한다. KIS 키 미설정 시 candlesSaved=0 + message 로 graceful.
   *
   * @param opts.cap         수집 상한(미지정 시 env KIS_MINUTE_COLLECT_CAP → MINUTE_COLLECT_DEFAULT_CAP)
   * @param opts.tradeDate   적재 거래일 강제(YYYYMMDD, 미지정 시 KRX 실 가용 거래일로 해석)
   * @param opts.stockDelayMs 종목 호출 간 지연 ms(레이트리밋 스로틀, 기본 200)
   * @param opts.pageDelayMs  분봉 페이지 호출 간 지연 ms(기본 150)
   * @param opts.sleep        지연 주입(테스트용)
   */
  async collectOnce(
    opts: {
      cap?: number;
      tradeDate?: string;
      stockDelayMs?: number;
      pageDelayMs?: number;
      sleep?: (ms: number) => Promise<void>;
    } = {},
  ): Promise<MinuteCollectCoverage> {
    const cap = opts.cap ?? this.resolveCap();
    const stockDelayMs = opts.stockDelayMs ?? 200;
    const pageDelayMs = opts.pageDelayMs ?? 150;
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

    // ★DAR-423: 분봉은 '오늘 라이브' 세션 데이터다. 일봉 발행 기준 resolveLatestAvailableTradeDate
    //   는 장중 '오늘 일봉 미게시'로 어제를 반환해 라벨을 어긋나게 한다(분봉 ts 는 오늘 advancing).
    //   인트라데이 전용 해석기로 장중엔 today, 장외엔 직전 거래일을 라벨링한다.
    const tradeDate = opts.tradeDate ?? (await this.scheduler.resolveIntradayTradeDate());

    if (!this.kis.isConfigured) {
      return {
        tradeDate,
        totalCandidates: 0,
        requested: 0,
        skippedByQuota: 0,
        covered: 0,
        empty: 0,
        candlesSaved: 0,
        message: 'KIS API 미설정 — 분봉 수집 비활성',
      };
    }

    const candidates = await this.resolveUniverse();
    const totalCandidates = candidates.length;
    const universe = candidates.slice(0, cap);
    const skippedByQuota = Math.max(0, totalCandidates - universe.length);

    let covered = 0;
    let empty = 0;
    let candlesSaved = 0;

    this.logger.log(
      `[분봉] 수집 시작 tradeDate=${tradeDate} 후보=${totalCandidates} 수집대상=${universe.length} ` +
        `쿼터스킵=${skippedByQuota} (★forward 축적 — 과거 분봉 소급 불가)`,
    );

    for (let i = 0; i < universe.length; i++) {
      const { corpCode, stockCode } = universe[i];
      const candles = await this.kis.fetchMinuteCandlesFullDay(stockCode, {
        pageDelayMs,
        sleep,
      });
      const saved = await this.persistCandles(corpCode, stockCode, tradeDate, candles);
      if (candles.length > 0) {
        covered++;
        candlesSaved += saved;
      } else {
        empty++;
      }
      if (i < universe.length - 1 && stockDelayMs > 0) await sleep(stockDelayMs);
    }

    // ★커버리지 정직 로그 — 몇 종목 수집/누락(쿼터)했는지 명시.
    this.logger.log(
      `[분봉] 수집 완료 tradeDate=${tradeDate} 커버=${covered}/${universe.length} ` +
        `(빈종목=${empty}) 신규적재=${candlesSaved}행 쿼터미수집=${skippedByQuota}종목`,
    );

    return {
      tradeDate,
      totalCandidates,
      requested: universe.length,
      skippedByQuota,
      covered,
      empty,
      candlesSaved,
    };
  }

  /**
   * 분봉 캔들을 StockMinutePrice(TimescaleDB 하이퍼테이블)에 멱등 적재한다 — DAR-381 통합.
   *   KIS time(HHMMSS) + tradeDate(YYYYMMDD) → ts(파티션 키, 분 단위 instant)로 변환해 적재한다.
   *   PK(stockCode, ts) 충돌 시 createMany skipDuplicates(=ON CONFLICT DO NOTHING)로 누락 분만 신규 삽입.
   *   tradeDate 파생 컬럼도 함께 채워 조회(특정 종목·특정일 분봉 전체) 폴백을 받친다. 반환=신규 삽입 행수.
   */
  private async persistCandles(
    corpCode: string,
    stockCode: string,
    tradeDate: string,
    candles: KisMinuteCandle[],
  ): Promise<number> {
    const data: import('@prisma/client').Prisma.StockMinutePriceCreateManyInput[] = [];
    for (const c of candles) {
      // KIS time 은 HHMMSS — 분 단위(HHMM)로 절사. 형식 불량은 스킵.
      const hhmm = (c.time ?? '').slice(0, 4);
      if (!/^\d{4}$/.test(hhmm)) continue;
      if (c.close <= 0) continue;
      const ts = minuteTimestamp(tradeDate, hhmm);
      if (!ts) continue; // tradeDate/HHMM 조합이 유효 시각이 아니면 스킵.
      data.push({
        corpCode,
        stockCode,
        ts,
        tradeDate,
        openPrice: c.open,
        highPrice: c.high,
        lowPrice: c.low,
        closePrice: c.close,
        volume: BigInt(Math.max(0, Math.round(c.volume))),
      });
    }
    if (data.length === 0) return 0;
    const result = await this.prisma.stockMinutePrice.createMany({ data, skipDuplicates: true });
    return result.count;
  }

  /**
   * 수집 우선순위 종목 집합(corpCode,stockCode) — 보유·관심·신호 우선, 그다음 최신일 거래량 상위.
   * stockCode 중복 제거하며 우선순위 순서를 보존한다(쿼터 cap 은 호출자가 slice 로 적용).
   *
   * 우선순위:
   *   1) OPEN 포지션(모의 보유) — 장중 가격반응을 반드시 봐야 하는 종목.
   *   2) entryReady 매수신호(buyScore desc) — 진입 후보.
   *   3) 워치리스트 — 사용자 관심.
   *   4) 최신 거래일 거래량 상위(StockDailyPrice volume desc) — 유동성·반응성 큰 종목으로 빈자리 채움.
   */
  private async resolveUniverse(): Promise<Array<{ corpCode: string; stockCode: string }>> {
    const ordered = new Map<string, { corpCode: string; stockCode: string }>();
    const push = (corpCode?: string | null, stockCode?: string | null): void => {
      if (!corpCode || !stockCode) return;
      if (!/^\d{6}$/.test(stockCode)) return;
      if (!ordered.has(stockCode)) ordered.set(stockCode, { corpCode, stockCode });
    };

    const [open, signals, watch] = await Promise.all([
      this.prisma.position.findMany({
        where: { status: 'OPEN' },
        select: { corpCode: true, stockCode: true },
      }),
      this.prisma.tradingSignal.findMany({
        // ★DAR-389/DAR-129(불가침): 백필 신호 종목이 라이브 분봉 수집 유니버스(상한·점수순)를
        //   잠식해 현재 후보를 밀어내지 않도록 배제(KIS 쿼터 보호).
        where: { entryReady: true, disclosure: { isBackfill: false } },
        orderBy: { buyScore: 'desc' },
        select: { corpCode: true, stockCode: true },
      }),
      this.prisma.watchList.findMany({
        select: { company: { select: { corpCode: true, stockCode: true } } },
      }),
    ]);

    for (const r of open) push(r.corpCode, r.stockCode);
    for (const r of signals) push(r.corpCode, r.stockCode);
    for (const r of watch) push(r.company?.corpCode, r.company?.stockCode);

    // 4) 최신 거래일 거래량 상위로 빈자리 채움. 최신 거래일을 먼저 찾고 그 날의 거래량 desc 로 조회.
    const latest = await this.prisma.stockDailyPrice.findFirst({
      orderBy: { tradeDate: 'desc' },
      select: { tradeDate: true },
    });
    if (latest?.tradeDate) {
      const topVolume = await this.prisma.stockDailyPrice.findMany({
        where: { tradeDate: latest.tradeDate },
        orderBy: { volume: 'desc' },
        take: 500,
        select: { corpCode: true, stockCode: true },
      });
      for (const r of topVolume) push(r.corpCode, r.stockCode);
    }

    return [...ordered.values()];
  }

  /** 수집 상한 해석 — env KIS_MINUTE_COLLECT_CAP(양의 정수)이 있으면 사용, 없으면 기본값. */
  private resolveCap(): number {
    const raw = process.env.KIS_MINUTE_COLLECT_CAP;
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : MINUTE_COLLECT_DEFAULT_CAP;
  }
}
