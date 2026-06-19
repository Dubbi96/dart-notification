// backend/src/engine1-disclosure/disclosure-events/failed-event-recovery.scheduler.ts
// DAR-347: FAILED 이벤트 자동복구 스케줄러 (매시간)

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ExtractionStatus } from '@prisma/client';
import { DisclosureEventsService } from './disclosure-events.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';
import { KST_TIMEZONE } from '../../common/time/kst';

/** 1회 복구 사이클에서 재처리할 최대 건수(DART 호출 0, 보유 parsedJson 재사용). */
const RECOVERY_BATCH = 200;

/**
 * 복구 후 잔존 FAILED 가 이 임계를 넘으면 경보(logger.error)로 표면화한다.
 * 한 사이클(200건) 재처리로도 줄지 않는 대량 적체 = 코드/데이터 결함 신호.
 */
const FAILED_BACKLOG_ALERT_THRESHOLD = 500;

/**
 * 복구 사이클 결과 상태.
 * - RAN: 이번 사이클이 실제로 복구를 수행함(끝까지 진입, 성공/예외 무관).
 * - SKIPPED: 이전 복구가 진행 중이라 겹침 가드가 즉시 차단함.
 */
export type RecoveryCycleStatus = 'RAN' | 'SKIPPED';

/**
 * FailedEventRecoveryScheduler (DAR-347) — FAILED 이벤트 자동복구·에스컬레이션 cron.
 *
 * ★근본원인: 추출 실패(FAILED) 이벤트를 주기적으로 재처리/경보하는 경로가 없었다.
 *   - processPendingDisclosures 는 PENDING 만 드레인(FAILED 미포함).
 *   - /disclosure-events/reprocess(OTHER·FAILED 대상)는 존재하나 크론 미연결 →
 *     운영자가 수동 호출하기 전까지 FAILED 가 무한 적체되어 사일런트 손실로 번졌다.
 *   - ParseRetryScheduler 는 문서 파싱(PARSE_FAILED)만 대상이라 이벤트 추출 단계의
 *     FAILED 는 누구도 회수하지 못했다.
 *
 * 본 스케줄러는 매시간 DisclosureEventsService.reprocessForNewExtractors() 를 호출해
 *   FAILED(및 OTHER) 이벤트를 신규 extractor 로 재추출한다. reprocess 는 upsert(rcpNo)
 *   기반이라 멱등(반복 무해) — 기존 경로를 그대로 재사용하므로 service 대규모 변경이 없다.
 *
 * ★경보: 복구 후에도 FAILED 잔량이 임계(500)를 넘으면 logger.error 로 에스컬레이션해
 *   '한 사이클로 줄지 않는 적체'를 운영 안전망에 노출한다(사일런트 손실 방지).
 *
 * ★멱등: reprocessForNewExtractors 의 모든 갱신이 upsert/상태조건 기반(반복 무해).
 * ★throw 금지: cron 스케줄 유지를 위해 예외를 흡수한다(recorder 가 FAILED 기록).
 * ★겹침 가드: reprocess 200건은 cron 간격(1시간)을 초과할 수 있어, in-flight 플래그로
 *   사이클을 직렬화하고 진행 중이면 즉시 SKIPPED 로 빠진다(중복 재처리 방지).
 */
@Injectable()
export class FailedEventRecoveryScheduler {
  private readonly logger = new Logger(FailedEventRecoveryScheduler.name);

  /** 겹침 가드 — 복구 1회가 끝날 때까지 다음 사이클 진입을 막는다. */
  private isRecovering = false;

  constructor(
    private readonly disclosureEventsService: DisclosureEventsService,
    private readonly prisma: PrismaService,
    // @Optional: CronHealthModule 미등록 환경(일부 테스트)에서도 동작. 미주입 시 기록만 생략.
    @Optional() private readonly recorder?: CronRunRecorderService,
  ) {}

  /** 매시간 정각 FAILED 이벤트 자동복구. (간격형이라 TZ 무관이나 KST 명시로 의도 고정) */
  @Cron('0 * * * *', { timeZone: KST_TIMEZONE })
  async recoverFailedEvents(): Promise<RecoveryCycleStatus> {
    // 이전 사이클이 아직 진행 중이면 겹치지 않도록 즉시 스킵(중복 재처리 방지).
    if (this.isRecovering) {
      this.logger.warn('이전 복구가 진행 중 — 이번 사이클 SKIPPED(겹침 방지)');
      return 'SKIPPED';
    }
    // ★주의: 첫 await 이전에 동기적으로 락을 잡아야 겹친 cron 이 가드를 통과하지 못한다.
    this.isRecovering = true;

    this.logger.log('FAILED 이벤트 자동복구 스케줄러 실행');

    const run = () =>
      this.disclosureEventsService.reprocessForNewExtractors(RECOVERY_BATCH);

    try {
      if (!this.recorder) {
        await run();
        await this.alertIfBacklogHigh();
        return 'RAN';
      }
      // DAR-110 연계: 마지막 성공시각/재분류건수 기록(신선도 판정 입력).
      await this.recorder.record(CRON_JOB_KEYS.FAILED_EVENT_RECOVERY, run, {
        countOf: (r) => r.reclassified,
      });
      await this.alertIfBacklogHigh();
      return 'RAN';
    } catch (error) {
      this.logger.error('FAILED 이벤트 자동복구 스케줄러 오류', error);
      return 'RAN';
    } finally {
      // 성공·실패 무관 락 해제 — 다음 cron 이 정상 진입할 수 있어야 한다.
      this.isRecovering = false;
    }
  }

  /**
   * 복구 후 잔존 FAILED 적체를 점검해 임계 초과 시 경보한다.
   * 카운트/경보 실패가 본업(복구)이나 cron 스케줄을 깨뜨리지 않도록 예외를 흡수한다.
   */
  private async alertIfBacklogHigh(): Promise<void> {
    try {
      const backlog = await this.prisma.disclosureEvent.count({
        where: { extractionStatus: ExtractionStatus.FAILED },
      });
      if (backlog > FAILED_BACKLOG_ALERT_THRESHOLD) {
        this.logger.error(
          `[경보] FAILED 이벤트 적체 ${backlog}건 — 임계(${FAILED_BACKLOG_ALERT_THRESHOLD}) 초과. ` +
            '한 복구 사이클로 줄지 않는 적체 = extractor/데이터 결함 가능성, 운영 점검 필요.',
        );
      } else {
        this.logger.log(`FAILED 잔존 ${backlog}건 (임계 ${FAILED_BACKLOG_ALERT_THRESHOLD} 이하)`);
      }
    } catch (error) {
      // 경보 점검 자체의 실패는 best-effort — 본업·cron 유지를 위해 삼킨다.
      this.logger.warn(
        `FAILED 적체 점검 실패(무시): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
