/**
 * PaperSimulationScheduler — 모의운용 Cron (M10 모의운용, DAR-40 / DAR-366)
 *
 * - 일일 사이클: 장마감·시세수집(KRX 18:30) 이후 1회 매수→스냅샷→Exit→지표.
 * - 장중 손절 모니터(DAR-366): 정규장(09:00~15:30) N분 간격으로 보유종목 실시간 능동 fetch 후
 *   Exit 평가 — 실시간 실가 -8% 손절이 실제 발화하는 유일 경로(일배치는 장 마감 후라 실시간 부재).
 * AI 금지영역: 스케줄러는 트리거만 — 점수·체결 결정 없음.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PaperSimulationService, DailyCycleResult } from './paper-simulation.service';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';
import { KST_TIMEZONE, formatKstDateCompact } from '../../common/time/kst';

@Injectable()
export class PaperSimulationScheduler {
  private readonly logger = new Logger(PaperSimulationScheduler.name);

  constructor(
    private readonly sim: PaperSimulationService,
    // @Optional: CronHealthModule 미등록 환경(일부 테스트)에서도 동작. 미주입 시 기록만 생략.
    @Optional() private readonly recorder?: CronRunRecorderService,
  ) {}

  /** 평일 19:30(KST) — KRX 일봉(18:30)·지수(18:45) 수집 이후 모의운용 1사이클 */
  @Cron('30 19 * * 1-5', { timeZone: KST_TIMEZONE })
  async runDaily(): Promise<DailyCycleResult> {
    const tradeDate = this.todayBasDd();
    this.logger.log(`[PaperSim][Cron] 일일 모의운용 실행 tradeDate=${tradeDate}`);
    const run = () => this.sim.runDailyCycle(tradeDate);
    if (!this.recorder) return run();
    // DAR-110: 마지막 성공시각/스냅샷건수 기록(신선도 판정 입력).
    return this.recorder.record(CRON_JOB_KEYS.PAPER_SIMULATION, run, {
      countOf: (r) => r.snapshotted,
    });
  }

  /**
   * DAR-366: 평일 09:00~15:55 매 5분(KST) 장중 손절 모니터.
   *   cron 시(hour) 9-15 까지 발화하되, 서비스가 정규장 종료(15:30) 게이트로 15:35~15:55 틱은 스킵한다
   *   (cron 만으로 15:30 컷을 못 거니 메서드 게이트가 정본). 장외/주말/휴장/키 미설정은 무가동 스킵.
   */
  @Cron('*/5 9-15 * * 1-5', { timeZone: KST_TIMEZONE })
  async runIntradayExitMonitor(): Promise<void> {
    const run = () => this.sim.runIntradayExitMonitor();
    // 스킵(장외/겹침)은 CronRunLog 를 더럽히지 않도록 기록하지 않는다 — 실제 평가가 돈 틱만 기록.
    if (!this.recorder) {
      await run();
      return;
    }
    const result = await run();
    if (!result.ran) return; // 스킵 틱은 기록 생략(스팸 0)
    await this.recorder.record(CRON_JOB_KEYS.INTRADAY_EXIT_MONITOR, async () => result, {
      countOf: (r) => r.exited,
    });
  }

  /** 오늘 거래일 YYYYMMDD(KST). 시스템 TZ 무관 — UTC 새벽 전일 반환 방지(DAR-199). */
  private todayBasDd(): string {
    return formatKstDateCompact(new Date());
  }
}
