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
 * - RAN: 이번 사이클이 실제 드레인을 수행함(끝까지 진입, 성공/예외/타임아웃 무관).
 * - SKIPPED: 이전 드레인이 진행 중이라 겹침 가드가 즉시 차단함.
 */
export type EventBackfillCycleStatus = 'RAN' | 'SKIPPED';

/**
 * 드레인 1회의 최대 허용 시간(ms) — 초과 시 강제 타임아웃 종료한다 (행(hang) 방지).
 *
 * 근거(prod 실증 7/9): drainOnce() 는 무타임아웃이라 DB 커넥션 문제로 쿼리가 무한 대기하면
 * `isDraining` 이 영구 true 로 굳어(finally 가 영영 실행되지 않음) 재시작 전까지 모든 후속
 * 사이클이 SKIPPED 로 막힌다(RUNNING 고착 → 다음 날 FAILED 재현). 10분이면 정상 배치(추출 200·
 * 파싱등록 200)의 최대 소요를 넉넉히 덮으면서, 병리적 행을 하루 안에 자가복구시킨다(다음 03:00 재시도).
 */
export const DRAIN_TIMEOUT_MS = 10 * 60 * 1000; // 10분

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
 * ★행 방지(타임아웃): drainOnce 를 DRAIN_TIMEOUT_MS 레이스로 감싸, 무한 대기해도 finally 가
 *   반드시 실행돼 `isDraining` 이 해제된다(락 영구 고착 방지). 타임아웃은 recorder 안에서 발생시켜
 *   FAILED 로 기록되게 한다 → 다음 날 정상 재시도.
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

    // ★행 방지: drainOnce 를 타임아웃 레이스로 감싼다. 무한 대기 시 DRAIN_TIMEOUT_MS 후 reject →
    //   recorder 가 FAILED 기록 → 아래 catch/finally 로 흡수·락 해제(다음 사이클 정상 진입).
    const run = (): Promise<EventBackfillDrainResult> =>
      this.withTimeout(this.drainService.drainOnce(), DRAIN_TIMEOUT_MS);

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
      // 성공·실패·타임아웃 무관 락 해제 — 다음 cron 이 정상 진입할 수 있어야 한다.
      this.isDraining = false;
    }
  }

  /**
   * promise 를 ms 타임아웃과 레이스한다 — ms 초과 시 reject(행 방지 강제 종료).
   *
   * - promise 가 먼저 정착하면 타이머를 정리하고 그 결과를 그대로 반환/전파한다.
   * - 타임아웃이 먼저면 reject → 호출부(recorder)가 FAILED 로 기록한다. 이때 원본 drainOnce
   *   promise 는 여전히 pending 이지만(무한 대기 쿼리는 여기서 취소 불가) 락은 이미 풀린다.
   * - unref(): 타이머가 프로세스 종료를 붙잡지 않게 한다(테스트/셧다운 안전).
   */
  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(
            `이벤트 추출 백필 드레인 타임아웃(${ms}ms 초과) — 행(hang) 방지 강제 종료`,
          ),
        );
      }, ms);
      timer.unref?.();
    });
    return Promise.race([promise, timeout]).finally(() => {
      if (timer) clearTimeout(timer);
    }) as Promise<T>;
  }
}
