import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CronJobKey } from './cron-health.jobs';

/** record() 옵션. */
export interface RecordOptions<T> {
  /** 트리거 출처. 기본 'CRON'. */
  triggeredBy?: 'CRON' | 'MANUAL';
  /**
   * 실행 결과에서 처리/신규 건수를 뽑는 추출기.
   * 미지정 시 0. 결과가 SKIPPED(중복 실행 등)면 호출하지 않는다.
   */
  countOf?: (result: T) => number;
  /**
   * 결과가 '건너뜀'인지 판단. true 면 status=SKIPPED 로 기록(실패 아님).
   * 예: 이전 실행 진행 중 락으로 조기 반환.
   */
  isSkipped?: (result: T) => boolean;
}

/**
 * CronRunRecorder (DAR-110) — 경량 크론의 실행 헬스를 CronRunLog 에 통일 기록한다.
 *
 * 자체 도메인 로그(*CollectionLog)가 없던 크론(신호생성·모의운용·내부자·파싱재처리)을
 * try/finally 로 감싸 마지막 성공시각/처리건수/실패를 남긴다. 이는 freshness 판정의 입력.
 *
 * ★불변식: 로깅 실패가 크론 본업을 깨뜨리지 않는다(메타 기록은 best-effort).
 *   - 본 작업(fn)의 예외는 그대로 재던짐(기존 거동 보존).
 *   - 로그 write 자체의 예외는 삼키고 경고만(수집은 계속).
 * AI·실주문·외부호출 없음 — DB 메타 기록만.
 */
@Injectable()
export class CronRunRecorderService {
  private readonly logger = new Logger(CronRunRecorderService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 크론 본문을 감싸 실행하고 결과를 기록한다. fn 의 반환값을 그대로 돌려준다.
   * fn 이 throw 하면 FAILED 기록 후 동일 예외를 재던진다(컨트롤러/스케줄러 거동 불변).
   */
  async record<T>(
    jobKey: CronJobKey,
    fn: () => Promise<T>,
    options: RecordOptions<T> = {},
  ): Promise<T> {
    const startedAt = new Date();
    const logId = await this.safeCreateRunning(jobKey, options.triggeredBy);

    try {
      const result = await fn();
      const skipped = options.isSkipped?.(result) ?? false;
      const itemCount = skipped ? 0 : (options.countOf?.(result) ?? 0);
      await this.safeFinalize(logId, {
        status: skipped ? 'SKIPPED' : 'SUCCESS',
        itemCount,
        startedAt,
      });
      return result;
    } catch (error) {
      await this.safeFinalize(logId, {
        status: 'FAILED',
        itemCount: 0,
        startedAt,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * DAR-503: 가드로 이번 사이클을 건너뛴 크론의 SKIPPED 를 CronRunLog 에 남긴다.
   * (예: 헤비 수집 잡의 주중 정지 — isHeavyCollectionWindow=false).
   *
   * 목적: 크론이 '살아 있으나 정책상 스킵함'을 운영 로그에 표면화한다(휴장 스킵 패턴 준용).
   *   SKIPPED 는 성공이 아니므로 freshness 의 lastSuccessAt 을 갱신하지 않는다 — 신선도 임계는
   *   별도로 주말 주기에 맞게 상향한다(cron-health.jobs). 기록 실패는 삼킨다(best-effort).
   */
  async recordSkip(
    jobKey: CronJobKey,
    triggeredBy: 'CRON' | 'MANUAL' = 'CRON',
  ): Promise<void> {
    const startedAt = new Date();
    const logId = await this.safeCreateRunning(jobKey, triggeredBy);
    await this.safeFinalize(logId, {
      status: 'SKIPPED',
      itemCount: 0,
      startedAt,
    });
  }

  /** RUNNING 행 생성 — 실패해도 본업 진행(로그 id 없이 계속). */
  private async safeCreateRunning(
    jobKey: string,
    triggeredBy: 'CRON' | 'MANUAL' = 'CRON',
  ): Promise<string | null> {
    try {
      const row = await this.prisma.cronRunLog.create({
        data: { jobKey, triggeredBy, status: 'RUNNING' },
        select: { id: true },
      });
      return row.id;
    } catch (error) {
      this.logger.warn(
        `[CronRunRecorder] RUNNING 기록 실패(${jobKey}) — 본업은 계속: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /** 종료 상태로 갱신 — best-effort. */
  private async safeFinalize(
    logId: string | null,
    data: {
      status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
      itemCount: number;
      startedAt: Date;
      errorMessage?: string;
    },
  ): Promise<void> {
    if (!logId) return;
    try {
      const finishedAt = new Date();
      await this.prisma.cronRunLog.update({
        where: { id: logId },
        data: {
          status: data.status,
          itemCount: data.itemCount,
          durationMs: finishedAt.getTime() - data.startedAt.getTime(),
          errorMessage: data.errorMessage ?? null,
          finishedAt,
        },
      });
    } catch (error) {
      this.logger.warn(
        `[CronRunRecorder] 종료 기록 실패(id=${logId}) — 무시: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
