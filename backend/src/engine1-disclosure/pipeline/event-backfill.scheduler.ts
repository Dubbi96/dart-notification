// backend/src/engine1-disclosure/pipeline/event-backfill.scheduler.ts
// DAR-391: 과거 공시 이벤트 추출 백필 일일 드레인 스케줄러 — rcpDt 연중 분포를 점진 확장.

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  EventBackfillDrainService,
  EventBackfillDrainResult,
} from './event-backfill-drain.service';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';
import { KST_TIMEZONE } from '../../common/time/kst';

/**
 * 드레인 사이클 결과 상태.
 * - RAN: 이번 사이클이 실제 드레인을 수행함(끝까지 진입, 성공/예외 무관).
 * - SKIPPED: 이전 드레인이 진행 중이라 겹침 가드가 즉시 차단함.
 */
export type EventBackfillCycleStatus = 'RAN' | 'SKIPPED';

/**
 * EventBackfillScheduler (DAR-391) — 과거 공시 이벤트 추출 백필 일일 드레인 cron.
 *
 * ★카덴스: 매일 03:00 KST(저트래픽·타 백필 크론과 분산). AI 백필(02:00)·내부자(03:30)와 비충돌.
 *   하루 한 배치(추출 200·파싱등록 200)만 진행 → 일자별로 rcpDt 분포를 과거로 점진 확장한다.
 *   즉시 전량 처리 불가 — 진행성은 drainOnce 의 잔여 백로그(remaining*)로 정직 표기된다.
 *
 * ★멱등: drainOnce 의 추출(upsert rcpNo)·파싱등록(upsert)이 반복 무해.
 * ★AI 미개입: 추출은 Rule(L0). AI는 기존 큐 체이닝(비용게이트)에 위임 — 본 경로 신규 AI 호출 0.
 * ★throw 금지: cron 스케줄 유지를 위해 예외를 흡수한다(recorder 가 FAILED 기록).
 * ★겹침 가드: 드레인 1회가 끝날 때까지 다음 사이클 진입을 막는다(중복 처리 방지).
 */
@Injectable()
export class EventBackfillScheduler {
  private readonly logger = new Logger(EventBackfillScheduler.name);

  /** 겹침 가드 — 드레인 1회가 끝날 때까지 다음 사이클 진입을 막는다. */
  private isDraining = false;

  constructor(
    private readonly drainService: EventBackfillDrainService,
    // @Optional: CronHealthModule 미등록 환경(일부 테스트)에서도 동작. 미주입 시 기록만 생략.
    @Optional() private readonly recorder?: CronRunRecorderService,
  ) {}

  /** 매일 03:00 KST 과거 공시 이벤트 추출 백필 드레인. */
  @Cron('0 3 * * *', { timeZone: KST_TIMEZONE })
  async drainBackfill(): Promise<EventBackfillCycleStatus> {
    // 이전 사이클이 아직 진행 중이면 겹치지 않도록 즉시 스킵(중복 처리 방지).
    if (this.isDraining) {
      this.logger.warn(
        '이전 이벤트 추출 백필 드레인이 진행 중 — 이번 사이클 SKIPPED(겹침 방지)',
      );
      return 'SKIPPED';
    }
    // ★주의: 첫 await 이전에 동기적으로 락을 잡아야 겹친 cron 이 가드를 통과하지 못한다.
    this.isDraining = true;

    this.logger.log('이벤트 추출 백필 드레인 스케줄러 실행');

    const run = (): Promise<EventBackfillDrainResult> =>
      this.drainService.drainOnce();

    try {
      if (!this.recorder) {
        await run();
        return 'RAN';
      }
      // DAR-110 연계: 마지막 성공시각/처리건수 기록(신선도 판정 입력).
      // itemCount = 이번 사이클에서 추출 성공 + 검토 회수 + 파싱 등록한 총 전진 건수.
      await this.recorder.record(CRON_JOB_KEYS.EVENT_BACKFILL_DRAIN, run, {
        countOf: (r) =>
          r.extractSuccess + r.extractNeedsReview + r.parseEnqueued,
      });
      return 'RAN';
    } catch (error) {
      this.logger.error('이벤트 추출 백필 드레인 스케줄러 오류', error);
      return 'RAN';
    } finally {
      // 성공·실패 무관 락 해제 — 다음 cron 이 정상 진입할 수 있어야 한다.
      this.isDraining = false;
    }
  }
}
