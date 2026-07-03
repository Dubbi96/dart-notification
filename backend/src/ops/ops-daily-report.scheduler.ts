import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { KST_TIMEZONE } from '../common/time/kst';
import { CronRunRecorderService } from '../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../cron-health/cron-health.jobs';
import { NotificationProducerService } from '../notifications/notification-producer.service';
import { OpsDailyReportService } from './ops-daily-report.service';
import { OpsDailyReport } from './ops-daily-report.types';

/**
 * OpsDailyReportScheduler (DAR-477, 견고화 W0·P05) — 장마감 후 일일 운영 리포트 발송 cron.
 *
 * ★카덴스: 평일/매일 20:30 KST — forward 트랙 사이클(철학 19:40·전략 19:45) 이후로 잡아
 *   당일 체결·손익이 반영된 스냅샷을 요약한다. (@Cron 은 매일 발화하나 주말엔 신규 활동이
 *   없어 '전일과 동일' 정직 요약이 나갈 뿐 — 매매엔 무접점.)
 *
 * ★발송: OpsDailyReportService.buildReport → NotificationProducer.enqueueOpsAlert(OPS_ALERT
 *   채널, DAR-473 P01). 멱등 자연키 dedupeKey='daily-report:<KST거래일>' 로 하루 1건만 적재된다.
 *
 * ★실행 헬스: CronRunRecorder 로 CronRunLog(jobKey=ops.daily-report)에 남겨 freshness 안전망에
 *   first-class 노출(FRESHNESS_JOB_SPECS 등록). 겹침 가드 + throw 금지(cron 스케줄 유지).
 * ★read-only 관측·알림 전용 — 실주문/Kill Switch 무직결(M10 클록 보호, 매매 행동 무변경).
 */
@Injectable()
export class OpsDailyReportScheduler {
  private readonly logger = new Logger(OpsDailyReportScheduler.name);

  /** 겹침 가드 — 한 사이클이 끝날 때까지 다음 진입을 막는다. */
  private isRunning = false;

  constructor(
    private readonly reportService: OpsDailyReportService,
    private readonly producer: NotificationProducerService,
    // @Optional: CronHealthModule 미등록 환경(일부 테스트)에서도 동작. 미주입 시 기록만 생략.
    @Optional() private readonly recorder?: CronRunRecorderService,
  ) {}

  /** 매일 20:30 KST — 일일 운영 리포트 생성·발송. 성공 시 리포트, 스킵/실패 시 null. */
  @Cron('30 20 * * *', { timeZone: KST_TIMEZONE })
  async runDaily(now: Date = new Date()): Promise<OpsDailyReport | null> {
    if (this.isRunning) {
      this.logger.warn('이전 일일 리포트가 진행 중 — 이번 사이클 스킵(겹침 방지)');
      return null;
    }
    this.isRunning = true;
    try {
      const run = (): Promise<OpsDailyReport> => this.publish(now);
      if (!this.recorder) {
        return await run();
      }
      // DAR-110 연계: 마지막 성공시각을 CronRunLog 에 남겨 신선도 판정 입력으로 쓴다.
      return await this.recorder.record(CRON_JOB_KEYS.OPS_DAILY_REPORT, run, {
        countOf: () => 1,
      });
    } catch (err) {
      // recorder 가 FAILED 를 기록한 뒤 재던진 예외 — cron 스케줄 유지를 위해 흡수한다.
      this.logger.error('[OpsDailyReport] 발송 실패(cron 유지)', err as Error);
      return null;
    } finally {
      this.isRunning = false;
    }
  }

  /** 리포트 생성 + OPS_ALERT 발행. */
  private async publish(now: Date): Promise<OpsDailyReport> {
    const report = await this.reportService.buildReport(now);
    await this.producer.enqueueOpsAlert(
      report.severity,
      'daily-report',
      report.body,
      {
        // 시간 버킷(KST 거래일) 포함 — 하루 1건 멱등(반복 발화·재시도 중복 억제).
        dedupeKey: `daily-report:${report.reportDateKst}`,
        data: {
          totalRealizedPnlKrw: report.pnl.totalRealizedPnlKrw,
          totalUnrealizedPnlKrw: report.pnl.totalUnrealizedPnlKrw,
          fills24h: report.fills.total,
          cronFailedRuns: report.cron.failedRuns,
          cronErrorRatePct: report.cron.errorRatePct,
          staleJobs: report.cron.staleJobs,
        },
      },
    );
    this.logger.log(
      `[OpsDailyReport] ${report.reportDateKst} severity=${report.severity} ` +
        `realized=${report.pnl.totalRealizedPnlKrw} unrealized=${report.pnl.totalUnrealizedPnlKrw} ` +
        `fills24h=${report.fills.total} cronFailed=${report.cron.failedRuns} stale=${report.cron.staleJobs.length}`,
    );
    return report;
  }
}
