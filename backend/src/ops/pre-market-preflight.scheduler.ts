import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { KST_TIMEZONE } from '../common/time/kst';
import { CronRunRecorderService } from '../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../cron-health/cron-health.jobs';
import { NotificationProducerService } from '../notifications/notification-producer.service';
import { OpsAlertSeverity } from '../common/queues/queue.constants';
import { PreMarketPreflightService } from './pre-market-preflight.service';
import {
  PreflightFinding,
  PreMarketPreflightReport,
} from './pre-market-preflight.types';

/** 심각도 순위(집계용) — 높은 값이 더 심각. */
const SEVERITY_RANK: Record<OpsAlertSeverity, number> = {
  INFO: 0,
  WARNING: 1,
  ERROR: 2,
  CRITICAL: 3,
};

/** 소견 목록에서 최고 심각도 산출(빈 목록이면 INFO). */
function maxSeverity(findings: PreflightFinding[]): OpsAlertSeverity {
  return findings.reduce<OpsAlertSeverity>(
    (max, f) => (SEVERITY_RANK[f.severity] > SEVERITY_RANK[max] ? f.severity : max),
    'INFO',
  );
}

/**
 * PreMarketPreflightScheduler (DAR-487, 견고화 W3·P26) — 장 시작 전 종합 프리플라이트 cron.
 *
 * ★카덴스: 평일 08:30 KST — 기존 장 시작 전 데이터 준비 잡(08:40 시장분류·08:50 종목상태)보다
 *   앞서 실행해 토큰·휴장일·전일 일봉 정합·리스크 상태를 일괄 점검한다. 주말은 cron 미발화(1-5),
 *   평일 공휴일은 서비스가 isTradingDay 로 걸러 SKIPPED 처리(무발송·정상 로그).
 *
 * ★발송(P02 채널 재사용): 이상 발견 시에만 즉시 알림 — RISK 소견(킬스위치·게이트)은
 *   enqueueRiskAlert, OPS 소견(토큰·데이터)은 enqueueOpsAlert. 정상이면 무발송(로그만).
 *   멱등 자연키 dedupeKey='preflight-(risk|ops):<KST거래일>' 로 하루 최대 각 1건.
 *
 * ★실행 헬스: CronRunRecorder 로 CronRunLog(jobKey=ops.pre-market-preflight)에 남겨 freshness
 *   안전망에 first-class 노출(FRESHNESS_JOB_SPECS 등록). 휴장 스킵은 SKIPPED 로 기록(정상).
 * ★점검 전용 — 실주문/체결/판정 무직결(M10 클록 보호, 매매 행동 무변경). 겹침 가드 + throw 금지.
 */
@Injectable()
export class PreMarketPreflightScheduler {
  private readonly logger = new Logger(PreMarketPreflightScheduler.name);

  /** 겹침 가드 — 한 사이클이 끝날 때까지 다음 진입을 막는다. */
  private isRunning = false;

  constructor(
    private readonly preflight: PreMarketPreflightService,
    private readonly producer: NotificationProducerService,
    // @Optional: CronHealthModule 미등록 환경(일부 테스트)에서도 동작. 미주입 시 기록만 생략.
    @Optional() private readonly recorder?: CronRunRecorderService,
  ) {}

  /** 평일 08:30 KST — 프리플라이트 실행. 스킵/실패 시 null, 그 외 리포트 반환. */
  @Cron('30 8 * * 1-5', { timeZone: KST_TIMEZONE })
  async runPreflight(now: Date = new Date()): Promise<PreMarketPreflightReport | null> {
    if (this.isRunning) {
      this.logger.warn('이전 프리플라이트가 진행 중 — 이번 사이클 스킵(겹침 방지)');
      return null;
    }
    this.isRunning = true;
    try {
      const run = (): Promise<PreMarketPreflightReport> => this.publish(now);
      if (!this.recorder) {
        return await run();
      }
      // 실행 헬스 기록 — 휴장 스킵은 SKIPPED, 그 외는 이상 건수를 itemCount 로.
      return await this.recorder.record(CRON_JOB_KEYS.PRE_MARKET_PREFLIGHT, run, {
        countOf: (r) => r.findings.length,
        isSkipped: (r) => r.overall === 'HOLIDAY',
      });
    } catch (err) {
      // recorder 가 FAILED 기록 후 재던진 예외 — cron 스케줄 유지를 위해 흡수한다.
      this.logger.error('[Preflight] 실행 실패(cron 유지)', err as Error);
      return null;
    } finally {
      this.isRunning = false;
    }
  }

  /** 리포트 생성 + (이상 시) RISK/OPS 알림 발행. */
  private async publish(now: Date): Promise<PreMarketPreflightReport> {
    const report = await this.preflight.buildReport(now);

    if (report.overall === 'HOLIDAY') {
      this.logger.log(`[Preflight] ${report.summary}`);
      return report;
    }

    if (report.findings.length === 0) {
      // 정상 — 무발송, 로그만(관측 가치 유지).
      this.logger.log(`[Preflight] ${report.summary}`);
      return report;
    }

    // 이상 — 채널별로 분리 발송(RISK/OPS). 동일 채널 다건은 한 알림으로 묶는다.
    this.logger.warn(`[Preflight] ${report.summary}`);
    const riskFindings = report.findings.filter((f) => f.channel === 'RISK');
    const opsFindings = report.findings.filter((f) => f.channel === 'OPS');

    if (riskFindings.length > 0) {
      await this.producer.enqueueRiskAlert(
        maxSeverity(riskFindings),
        'pre-market-preflight',
        this.channelBody('리스크 상태 점검', report.tradingDateKst, riskFindings),
        {
          dedupeKey: `preflight-risk:${report.tradingDateKst}`,
          deepLink: '/portfolio',
          data: {
            checks: report.checks,
            findings: riskFindings.map((f) => f.check),
          },
        },
      );
    }

    if (opsFindings.length > 0) {
      await this.producer.enqueueOpsAlert(
        maxSeverity(opsFindings),
        'pre-market-preflight',
        this.channelBody('데이터·토큰 점검', report.tradingDateKst, opsFindings),
        {
          dedupeKey: `preflight-ops:${report.tradingDateKst}`,
          deepLink: '/settings',
          data: {
            checks: report.checks,
            findings: opsFindings.map((f) => f.check),
          },
        },
      );
    }

    return report;
  }

  /** 채널 알림 본문 렌더(한국어 평문). */
  private channelBody(
    title: string,
    dateKst: string,
    findings: PreflightFinding[],
  ): string {
    const lines = [`장 시작 전 프리플라이트 — ${title} (${dateKst} KST)`];
    for (const f of findings) {
      lines.push(` · ${f.message}`);
    }
    return lines.join('\n');
  }
}
