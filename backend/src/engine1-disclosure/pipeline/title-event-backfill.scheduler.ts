// backend/src/engine1-disclosure/pipeline/title-event-backfill.scheduler.ts
// W4 신호 검증: 제목 기반 과거 공시 이벤트 백필 야간 크론 — DART 쿼터 소비 0(DB-only).

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  TitleEventBackfillService,
  TitleEventBackfillResult,
} from './title-event-backfill.service';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';
import { KST_TIMEZONE } from '../../common/time/kst';

/**
 * 백필 사이클 결과 상태.
 * - RAN: 이번 사이클이 실제 백필을 수행함(끝까지 진입, 성공/예외/타임아웃 무관).
 * - SKIPPED: 이전 백필이 진행 중이라 겹침 가드가 즉시 차단함.
 */
export type TitleBackfillCycleStatus = 'RAN' | 'SKIPPED';

/**
 * 백필 1회의 최대 허용 시간(ms) — 초과 시 강제 타임아웃 종료(행 방지, DAR-391 선례).
 * 타임아웃으로 중단돼도 생성분은 영속되므로 다음 날 사이클이 그대로 이어서 진척한다.
 */
export const TITLE_BACKFILL_TIMEOUT_MS = 10 * 60 * 1000; // 10분

/**
 * TitleEventBackfillScheduler (W4 신호 검증) — 제목 기반 이벤트 백필 야간 크론.
 *
 * ★카덴스: 매일 02:40 KST — 야간 저트래픽 슬롯(02:00 AI 백필·03:00 이벤트 추출 백필과 분산).
 *   DAR-503 주말 창 게이트를 적용하지 않는 이유: 이 잡은 DART 문서 fetch 를 전혀 하지 않아
 *   (DB read + createMany 만) 라이브 파싱 쿼터를 굶길 수 없다 — 주중 매일 실행이 안전하다.
 * ★멱등: 선정 술어(disclosureEvent is null) + createMany skipDuplicates → 반복 무해.
 * ★AI 미개입: 전 구간 Rule(L0). AI 큐 발행 0.
 * ★throw 금지: cron 스케줄 유지를 위해 예외를 흡수한다(recorder 가 FAILED 기록).
 * ★겹침 가드 + 타임아웃: DAR-391 선례 — 첫 await 이전 동기 락, finally 해제, 10분 레이스.
 */
@Injectable()
export class TitleEventBackfillScheduler {
  private readonly logger = new Logger(TitleEventBackfillScheduler.name);

  /** 겹침 가드 — 백필 1회가 끝날 때까지 다음 사이클 진입을 막는다. */
  private isRunning = false;

  constructor(
    private readonly backfillService: TitleEventBackfillService,
    // @Optional: CronHealthModule 미등록 환경(일부 테스트)에서도 동작. 미주입 시 기록만 생략.
    @Optional() private readonly recorder?: CronRunRecorderService,
  ) {}

  /** 매일 02:40 KST — 제목 기반 이벤트 백필 1회(DART 호출 0, DB-only). */
  @Cron('40 2 * * *', { timeZone: KST_TIMEZONE })
  async runNightly(): Promise<TitleBackfillCycleStatus> {
    // 이전 사이클이 아직 진행 중이면 겹치지 않도록 즉시 스킵(중복 처리 방지).
    if (this.isRunning) {
      this.logger.warn(
        '이전 제목 이벤트 백필이 진행 중 — 이번 사이클 SKIPPED(겹침 방지)',
      );
      return 'SKIPPED';
    }
    // ★주의: 첫 await 이전에 동기적으로 락을 잡아야 겹친 cron 이 가드를 통과하지 못한다.
    this.isRunning = true;

    this.logger.log('제목 기반 이벤트 백필 스케줄러 실행');

    // ★행 방지: backfillOnce 를 타임아웃 레이스로 감싼다. 무한 대기 시 reject →
    //   recorder 가 FAILED 기록 → catch/finally 로 흡수·락 해제(다음 사이클 정상 진입).
    const run = (): Promise<TitleEventBackfillResult> =>
      this.withTimeout(
        this.backfillService.backfillOnce(),
        TITLE_BACKFILL_TIMEOUT_MS,
      );

    try {
      if (!this.recorder) {
        await run();
        return 'RAN';
      }
      // DAR-110 연계: 마지막 성공시각/생성건수 기록(신선도 판정 입력).
      await this.recorder.record(CRON_JOB_KEYS.TITLE_EVENT_BACKFILL, run, {
        countOf: (r) => r.created,
      });
      return 'RAN';
    } catch (error) {
      this.logger.error('제목 기반 이벤트 백필 스케줄러 오류', error);
      return 'RAN';
    } finally {
      // 성공·실패·타임아웃 무관 락 해제 — 다음 cron 이 정상 진입할 수 있어야 한다.
      this.isRunning = false;
    }
  }

  /**
   * promise 를 ms 타임아웃과 레이스한다 — ms 초과 시 reject(행 방지 강제 종료).
   * DAR-391 event-backfill.scheduler 의 withTimeout 과 동일 패턴.
   */
  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(
            `제목 이벤트 백필 타임아웃(${ms}ms 초과) — 행(hang) 방지 강제 종료`,
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
