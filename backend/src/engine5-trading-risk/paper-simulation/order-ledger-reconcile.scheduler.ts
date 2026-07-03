import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { KST_TIMEZONE } from '../../common/time/kst';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';
import { OrderLedgerReconcileService } from './order-ledger-reconcile.service';
import { ReconcileReport } from './order-ledger-reconcile';

/**
 * OrderLedgerReconcileScheduler (DAR-498, 견고화 W2·P22 §4) — 일일 주문 원장 대조 cron.
 *
 * ★카덴스: 매일 20:45 KST — 시스템 모의 일일 사이클(19:30)·forward 트랙(19:40~19:50)·장중
 *   체결까지 모두 반영된 뒤 스냅샷을 대조한다. (@Cron 은 매일 발화하나 주말엔 신규 체결이
 *   없어 '정합 0건' 무소음 로그만 — 매매엔 무접점.)
 *
 * ★동작: OrderLedgerReconcileService.reconcileDay → 불일치 시에만 P02 OPS_ALERT(하루 1건 멱등).
 * ★실행 헬스: CronRunRecorder 로 CronRunLog(jobKey=paper.order-ledger-reconcile)에 남겨 freshness
 *   안전망에 first-class 노출(FRESHNESS_JOB_SPECS 등록). 겹침 가드 + throw 금지(cron 스케줄 유지).
 * ★read-only 관측·알림 전용 — 실주문/원장 무접점(M10 클록 보호, 매매 행동 무변경).
 */
@Injectable()
export class OrderLedgerReconcileScheduler {
  private readonly logger = new Logger(OrderLedgerReconcileScheduler.name);

  /** 겹침 가드 — 한 대조가 끝날 때까지 다음 진입을 막는다. */
  private isRunning = false;

  constructor(
    private readonly reconcile: OrderLedgerReconcileService,
    // @Optional: CronHealthModule 미등록 환경(일부 테스트)에서도 동작. 미주입 시 기록만 생략.
    @Optional() private readonly recorder?: CronRunRecorderService,
  ) {}

  /** 매일 20:45 KST — 주문 원장 대조. 성공 시 리포트, 스킵/실패 시 null. */
  @Cron('45 20 * * *', { timeZone: KST_TIMEZONE })
  async runDaily(now: Date = new Date()): Promise<ReconcileReport | null> {
    if (this.isRunning) {
      this.logger.warn('이전 원장 대조가 진행 중 — 이번 사이클 스킵(겹침 방지)');
      return null;
    }
    this.isRunning = true;
    try {
      const run = (): Promise<ReconcileReport> => this.reconcile.reconcileDay(now);
      if (!this.recorder) {
        return await run();
      }
      // DAR-110 연계: 마지막 성공시각을 CronRunLog 에 남겨 신선도 판정 입력으로 쓴다.
      //   itemCount = 대조한 체결 건수(파생 기준).
      return await this.recorder.record(
        CRON_JOB_KEYS.ORDER_LEDGER_RECONCILE,
        run,
        { countOf: (r) => r.countPaper },
      );
    } catch (err) {
      // recorder 가 FAILED 를 기록한 뒤 재던진 예외 — cron 스케줄 유지를 위해 흡수한다.
      this.logger.error('[원장대조] 실패(cron 유지)', err as Error);
      return null;
    } finally {
      this.isRunning = false;
    }
  }
}
