import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { KST_TIMEZONE } from '../../common/time/kst';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';
import {
  IndicatorBackfillService,
  IndicatorBackfillResult,
} from './indicator-backfill.service';

/** 겹침 가드 조기반환 메시지 — recorder isSkipped 판정과 spec 이 공유하는 계약값. */
export const INDICATOR_DAILY_SKIP_MESSAGE = '이전 작업 진행 중';

/**
 * IndicatorDailyScheduler — 일일 기술지표 계산 크론.
 *
 * 배경(진단 확정): 기술지표(TechnicalIndicator)는 수동 백필 전용이라 prod 에서 한 번도
 * 계산된 적이 없었다(0행). 그 결과 신호 생성(signal-generation `loadStockContextAsOf`)의
 * 지표 컨텍스트가 전부 null → chart 버킷(과거 평균 +19.5, 66% 종목) 전멸 → 6/19 이후
 * 매수등급(BUY/STRONG_BUY_CANDIDATE) 신호 0건으로 홈 '오늘의 투자판단'이 정체됐다.
 *
 * 처방: KRX 일봉 캐치업 체인과 정합하는 2슬롯 크론으로 매 평일 지표를 적재한다.
 *   - 18:50 — 18:30 일봉 캐치업 후·19:00 신호 생성 전(같은 날 지표가 신호에 반영).
 *   - 21:10 — 21:00 일봉 EOD 재시도(DAR-438) 후 동일 경로 재발화. 18:50 에 KRX 미게시로
 *     일봉이 비어 있었어도 21:10 에 같은 멱등 경로가 당일분 지표를 자가복구한다.
 * 두 슬롯은 동일 경로(SSOT `runDailyIndicatorsWithHealth`)를 공유한다.
 *
 * 계산 본체는 IndicatorBackfillService.backfill({ mode: 'latest' }) 재사용(계산 로직 중복 0) —
 * StockDailyPrice 에서 종목별 최신 거래일 1건을 계산해 (stockCode, tradeDate) 멱등 upsert.
 * mode='latest' 라 첫 실행이 prod 의 지표 공백(전 종목 최신일)을 즉시 메운다.
 *
 * ★throw 금지(cron 스케줄 유지): 오류는 recorder 가 FAILED 기록 후 재던진 것을 흡수하고
 *   message 로 정직 보고한다. ★겹침 가드: 이전 실행 진행 중이면 SKIPPED(중복 부하 방지).
 * AI 금지영역: 지표 계산은 순수 Rule(calcAllIndicators). 점수 공식·등급 임계 무변경 —
 *   결측 데이터 복구일 뿐 전략 룰 변경이 아니다. 실주문·모의 체결 경로 무접점.
 */
@Injectable()
export class IndicatorDailyScheduler {
  private readonly logger = new Logger(IndicatorDailyScheduler.name);

  /** 단일 실행 락 — 18:50/21:10 슬롯·수동 트리거 겹침 방지. */
  private isCalculating = false;

  constructor(
    private readonly indicatorBackfill: IndicatorBackfillService,
    // @Global CronHealthModule 제공 — 미주입(테스트 등) 시 graceful 생략.
    @Optional() private readonly cronRunRecorder?: CronRunRecorderService,
  ) {}

  /** 평일 18:50(KST) — 일봉 캐치업(18:30) 후·신호 생성(19:00) 전 일일 지표 계산. */
  @Cron('50 18 * * 1-5', { timeZone: KST_TIMEZONE })
  async calculateDailyIndicators(): Promise<IndicatorBackfillResult> {
    return this.runDailyIndicatorsWithHealth();
  }

  /** 평일 21:10(KST) — 일봉 EOD 재시도(21:00, DAR-438) 후 동일 멱등 경로 재발화. */
  @Cron('10 21 * * 1-5', { timeZone: KST_TIMEZONE })
  async retryCalculateDailyIndicators(): Promise<IndicatorBackfillResult> {
    return this.runDailyIndicatorsWithHealth();
  }

  /**
   * 일일 지표 계산을 cron-health(CronRunLog) 래핑으로 실행한다 — 18:50 정시 슬롯과
   * 21:10 재시도 슬롯이 공유하는 SSOT. recorder 미주입 시 직접 호출(기존 거동 보존),
   * 락 조기반환은 SKIPPED, 오류는 FAILED 기록 후 흡수(★throw 금지 — cron 유지).
   */
  private async runDailyIndicatorsWithHealth(): Promise<IndicatorBackfillResult> {
    const run = () => this.calculateOnce();
    try {
      if (!this.cronRunRecorder) return await run();
      return await this.cronRunRecorder.record(CRON_JOB_KEYS.INDICATOR_DAILY, run, {
        countOf: (r) => r.indicatorsWritten,
        isSkipped: (r) => r.message === INDICATOR_DAILY_SKIP_MESSAGE,
      });
    } catch (e) {
      // recorder 가 FAILED 기록 후 재던진 예외를 흡수해 cron 스케줄 유지.
      this.logger.error(`[지표크론] 일일 지표 계산 오류: ${(e as Error).message}`);
      return this.emptyResult((e as Error).message);
    }
  }

  /**
   * 1회 지표 계산 본체(수동/cron 공용) — 겹침 가드 후 백필 서비스 재사용.
   * mode='latest': 종목별 최신 거래일 1건만 계산·멱등 upsert(재실행 무해).
   */
  async calculateOnce(): Promise<IndicatorBackfillResult> {
    if (this.isCalculating) {
      this.logger.warn('[지표크론] 이전 계산 진행 중 — 이번 회차 건너뜀(겹침 방지)');
      return this.emptyResult(INDICATOR_DAILY_SKIP_MESSAGE);
    }

    this.isCalculating = true;
    try {
      return await this.indicatorBackfill.backfill({ mode: 'latest' });
    } finally {
      this.isCalculating = false;
    }
  }

  private emptyResult(message: string): IndicatorBackfillResult {
    return {
      stocksProcessed: 0,
      indicatorsWritten: 0,
      stocksSkippedNoData: 0,
      targetDates: [],
      message,
    };
  }
}
