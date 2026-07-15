import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { KisEtfDailySource } from './kis-etf-daily.source';
import { EtfDailyBar, EtfDailyPriceSource } from './etf-daily-source';
import { ETF_UNIVERSE_CODES } from './etf-universe';
import { isValidDailyOhlc } from './daily-price-sanity';
import { KST_TIMEZONE, formatKstDateCompact } from '../../common/time/kst';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';

/**
 * EtfDailyPriceCollector — ETF 일봉 증분 수집 (DAR-484 [견고화 W1·P10]).
 *
 * Wave1 듀얼모멘텀(P12/P13)·변동성 돌파(P14/P15) 트랙이 소비할 ETF 일봉을 장마감 후 EOD 로 적재한다.
 *   - 소스 = KIS 기간별시세(KisEtfDailySource). KRX etp 는 401(미구독)이라 미구현(어댑터 인터페이스만).
 *   - 유니버스 4~5종 × [최근 N일] 구간을 한 번에 받아 EtfDailyPrice 에 멱등 적재(createMany
 *     skipDuplicates). 유량 부담 극소(일 4~5콜). EOD 종가는 마감 후 불변이라 재실행해도 무해.
 *   - 기존 KRX 일봉 크론(18:30/21:00)과 시간대 분리(평일 19:10 EOD). 백필(3년+)은 P11 별도 이슈.
 *   - 평일 08:00 아침 슬롯 추가 — 밤사이 확정된 전일분을 개장 전에 확보(19:10 EOD 와 동일 경로 재호출).
 *
 * ★graceful: KIS 키 미설정(isAvailable=false)이면 즉시 no-op(실호출 0, 적재 0). ★throw 금지(cron 유지).
 * ★정직: 적재가는 실제 시장 EOD 일봉. OHLC 물리 정합성(daily-price-sanity)을 행 단위로 검사해
 *   손상행을 배제한다. source 컬럼에 어느 어댑터가 적재했는지(KIS) 기록.
 *
 * AI 금지영역: 순수 HTTP/적재. 점수·체결·하드룰과 무관(읽기 전용 시세 수집·데이터층 전용).
 *   측정 트랙 매매 행동 무변경(M10 클록 안전) — 본 수집은 신규 데이터층으로 기존 경로에 무접점.
 */

/** 증분 조회 구간(달력일) 기본값 — 주말·연휴 공백을 흡수하는 최근 N일. env ETF_DAILY_LOOKBACK_DAYS 로 조정. */
export const ETF_DAILY_LOOKBACK_DEFAULT_DAYS = 10;

/** 1회 수집 커버리지(정직 보고). */
export interface EtfDailyCollectResult {
  /** 수집 기준일(KST 오늘, YYYYMMDD). */
  asOf: string;
  /** 조회 구간 시작일(YYYYMMDD). */
  fromDate: string;
  /** 유니버스 종목 수. */
  universeSize: number;
  /** 일봉을 1행 이상 받은 종목 수. */
  covered: number;
  /** 일봉이 0행이던 종목 수(휴장·미상장·실패). */
  empty: number;
  /** 신규로 적재된 일봉 행 수(멱등 — 이미 있던 행 제외). */
  rowsSaved: number;
  /** OHLC 정합성 검사에서 거른 손상행 수(정직 고지). */
  invalidSkipped: number;
  message?: string;
}

@Injectable()
export class EtfDailyPriceCollector {
  private readonly logger = new Logger(EtfDailyPriceCollector.name);

  /** 단일 실행 락 — 재시도/겹침으로 rate-limit·중복부하 내지 않도록. */
  private isCollecting = false;

  /** 활성 소스(1차 = KIS). KRX etp 구독 승인 시 여기서 소스를 교체/폴백 체인으로 확장. */
  private readonly source: EtfDailyPriceSource;

  constructor(
    private readonly prisma: PrismaService,
    kisSource: KisEtfDailySource,
    // @Global CronHealthModule 제공 — 미주입(테스트 등) 시 graceful 생략.
    @Optional() private readonly cronRunRecorder?: CronRunRecorderService,
  ) {
    this.source = kisSource;
  }

  /** 평일 19:10(KST) — ETF 일봉 증분 수집(KRX 18:30/21:00 크론과 시간대 분리). */
  @Cron('10 19 * * 1-5', { timeZone: KST_TIMEZONE })
  async collectEtfDailyPricesCron(
    now: Date = new Date(),
  ): Promise<EtfDailyCollectResult | { skipped: true }> {
    if (this.isCollecting) {
      this.logger.warn('[ETF일봉] 이전 수집 진행 중 — 이번 회차 건너뜀(겹침·rate-limit 방지)');
      return { skipped: true };
    }

    this.isCollecting = true;
    const run = () => this.collectOnce({ now });
    try {
      if (!this.cronRunRecorder) return await run();
      // 마지막 성공시각/적재건수 기록(신선도 안전망 노출 + 실패 표면화 → P02 OPS_ALERT).
      return await this.cronRunRecorder.record(CRON_JOB_KEYS.ETF_DAILY_COLLECT, run, {
        countOf: (r) => r.rowsSaved,
      });
    } catch (e) {
      // recorder 가 FAILED 기록 후 재던진 예외를 흡수해 cron 스케줄 유지.
      this.logger.error(`[ETF일봉] 수집 오류: ${(e as Error).message}`);
      return { skipped: true };
    } finally {
      this.isCollecting = false;
    }
  }

  /**
   * 평일 08:00(KST) — ETF 일봉 이른 아침 수집 슬롯 (데이터 축적 T+1 지연 해소).
   *
   * KIS 기간별시세도 EOD 종가가 마감 후 확정되므로 저녁 슬롯(19:10)만으로는 전일분이 개장 전에
   * 준비되지 않는 창이 생긴다. 밤사이 확정된 전일분을 08:00 에 확보해, Wave1 듀얼모멘텀/변동성돌파
   * 트랙 입력(EtfDailyPrice)이 개장 전 최신 상태가 되게 한다. 19:10 슬롯과 동일 경로
   * (collectEtfDailyPricesCron·SSOT)를 재호출한다 — 단일 실행 락·멱등 적재(skipDuplicates)·소스
   * 비활성 graceful 이 그대로 적용돼 순수 상방(중복=0건 삽입, 미확정=빈 응답 no-op).
   */
  @Cron('0 8 * * 1-5', { timeZone: KST_TIMEZONE })
  async collectEtfDailyPricesMorningCron(
    now: Date = new Date(),
  ): Promise<EtfDailyCollectResult | { skipped: true }> {
    return this.collectEtfDailyPricesCron(now);
  }

  /**
   * 1회 ETF 일봉 수집 본체(수동/cron 공용). 유니버스 각 종목의 [최근 N일] 일봉을 멱등 적재하고
   * 커버리지를 정직 보고한다. 소스 비활성(키 미설정) 시 rowsSaved=0 + message 로 graceful.
   *
   * @param opts.now          기준 시각(KST '오늘' 산정, 테스트 주입)
   * @param opts.lookbackDays 조회 구간 달력일(미지정 시 env → 기본 10)
   * @param opts.codes        유니버스 코드 강제(테스트/부분수집, 미지정 시 ETF_UNIVERSE_CODES)
   * @param opts.etfDelayMs   종목 호출 간 지연 ms(레이트리밋 스로틀, 기본 150)
   * @param opts.sleep        지연 주입(테스트용)
   */
  async collectOnce(
    opts: {
      now?: Date;
      lookbackDays?: number;
      codes?: readonly string[];
      etfDelayMs?: number;
      sleep?: (ms: number) => Promise<void>;
    } = {},
  ): Promise<EtfDailyCollectResult> {
    const now = opts.now ?? new Date();
    const lookbackDays = opts.lookbackDays ?? this.resolveLookbackDays();
    const codes = opts.codes ?? ETF_UNIVERSE_CODES;
    const etfDelayMs = opts.etfDelayMs ?? 150;
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

    const asOf = formatKstDateCompact(now);
    const fromDate = formatKstDateCompact(
      new Date(now.getTime() - lookbackDays * 86_400_000),
    );

    if (!this.source.isAvailable()) {
      return {
        asOf,
        fromDate,
        universeSize: codes.length,
        covered: 0,
        empty: 0,
        rowsSaved: 0,
        invalidSkipped: 0,
        message: `${this.source.sourceName} 소스 비활성 — ETF 일봉 수집 스킵`,
      };
    }

    let covered = 0;
    let empty = 0;
    let rowsSaved = 0;
    let invalidSkipped = 0;

    this.logger.log(
      `[ETF일봉] 수집 시작 소스=${this.source.sourceName} 구간=${fromDate}~${asOf} 유니버스=${codes.length}종`,
    );

    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      const bars = await this.source.fetchDailyBars(code, {
        startYmd: fromDate,
        endYmd: asOf,
        nowMs: now.getTime(),
      });
      const { saved, invalid } = await this.persistBars(code, bars);
      invalidSkipped += invalid;
      if (bars.length > 0) {
        covered++;
        rowsSaved += saved;
      } else {
        empty++;
      }
      if (i < codes.length - 1 && etfDelayMs > 0) await sleep(etfDelayMs);
    }

    this.logger.log(
      `[ETF일봉] 수집 완료 구간=${fromDate}~${asOf} 커버=${covered}/${codes.length} ` +
        `(빈종목=${empty}) 신규적재=${rowsSaved}행 손상제외=${invalidSkipped}행`,
    );

    return {
      asOf,
      fromDate,
      universeSize: codes.length,
      covered,
      empty,
      rowsSaved,
      invalidSkipped,
    };
  }

  /**
   * ETF 일봉을 EtfDailyPrice 에 멱등 적재한다. OHLC 물리 정합성(daily-price-sanity)을 행 단위로
   * 검사해 손상행(음수·고<저·종/시 범위밖)을 배제하고, @@unique([etfCode, tradeDate]) 충돌은
   * createMany skipDuplicates(=ON CONFLICT DO NOTHING)로 누락일만 신규 삽입. 반환=신규 삽입 행수·손상수.
   */
  private async persistBars(
    etfCode: string,
    bars: EtfDailyBar[],
  ): Promise<{ saved: number; invalid: number }> {
    const data: import('@prisma/client').Prisma.EtfDailyPriceCreateManyInput[] = [];
    let invalid = 0;
    for (const b of bars) {
      if (!/^\d{8}$/.test(b.tradeDate)) {
        invalid++;
        continue;
      }
      const ohlc = {
        openPrice: Math.round(b.open),
        highPrice: Math.round(b.high),
        lowPrice: Math.round(b.low),
        closePrice: Math.round(b.close),
      };
      if (!isValidDailyOhlc(ohlc)) {
        invalid++;
        continue;
      }
      const tv = Math.round(b.tradingValue);
      data.push({
        etfCode,
        tradeDate: b.tradeDate,
        ...ohlc,
        volume: BigInt(Math.max(0, Math.round(b.volume))),
        tradingValue: tv > 0 ? BigInt(tv) : null,
        source: this.source.sourceName,
      });
    }
    if (data.length === 0) return { saved: 0, invalid };
    const result = await this.prisma.etfDailyPrice.createMany({
      data,
      skipDuplicates: true,
    });
    return { saved: result.count, invalid };
  }

  /** 조회 구간(달력일) 해석 — env ETF_DAILY_LOOKBACK_DAYS(양의 정수)이 있으면 사용, 없으면 기본값. */
  private resolveLookbackDays(): number {
    const raw = process.env.ETF_DAILY_LOOKBACK_DAYS;
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : ETF_DAILY_LOOKBACK_DEFAULT_DAYS;
  }
}
