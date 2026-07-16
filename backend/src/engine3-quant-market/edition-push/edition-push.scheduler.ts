/**
 * EditionPublishPushScheduler (DAR-523, Wave B/B2·P0) — 일일 에디션 발행 푸시 cron.
 *
 * ★카덴스: 평일 19:05 KST — 신호 생성(§5.15 SignalGenerationScheduler 19:00) 직후. 5분 여유로
 *   19:00 사이클(멱등 upsert)이 끝난 당일 에디션을 조회해 발행 푸시를 낸다.
 *   저녁 체인: 18:30 일봉 → 18:50 지표 → 19:00 신호 생성=에디션 발행 → **19:05 발행 푸시** → 19:30 모의운용.
 *
 * ★하드 가드: 빈 에디션(매수등급 0) 날은 서비스가 enqueue 자체를 하지 않는다(발송 0·수용기준 1).
 *   빈 날에도 크론은 SUCCESS(count 0)를 남겨 '크론 살아 있음'이 유지된다.
 *
 * ★실행 헬스: CronRunRecorder 로 CronRunLog(jobKey=edition.publish-push)에 남긴다. 조회·알림 계층
 *   전용(비임계)이라 PRICE_MOVE_ALERT 와 동형으로 freshness 안전망(FRESHNESS_JOB_SPECS)엔 등록하지
 *   않는다. 겹침 가드 + throw 흡수(cron 스케줄 유지).
 * ★read-only 조회·알림 전용 — 매매·체결·Kill Switch 무직결(M10 클록 보호·AI 0).
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { KST_TIMEZONE } from '../../common/time/kst';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';
import {
  EditionPublishPushService,
  EditionPushRunResult,
} from './edition-push.service';

@Injectable()
export class EditionPublishPushScheduler {
  private readonly logger = new Logger(EditionPublishPushScheduler.name);

  /** 겹침 가드 — 한 사이클이 끝날 때까지 다음 진입을 막는다. */
  private isRunning = false;

  constructor(
    private readonly service: EditionPublishPushService,
    // @Optional: CronHealthModule 미등록 환경(일부 테스트)에서도 동작. 미주입 시 기록만 생략.
    @Optional() private readonly recorder?: CronRunRecorderService,
  ) {}

  /** 평일 19:05 KST — 당일 에디션 발행 푸시(빈 에디션은 서비스 하드 가드가 발송 0). */
  @Cron('5 19 * * 1-5', { timeZone: KST_TIMEZONE })
  async publishDaily(now: Date = new Date()): Promise<EditionPushRunResult | null> {
    if (this.isRunning) {
      this.logger.warn('이전 에디션 발행 푸시가 진행 중 — 이번 사이클 스킵(겹침 방지)');
      return null;
    }
    this.isRunning = true;
    try {
      const run = (): Promise<EditionPushRunResult> => this.service.publishTodayEdition(now);
      if (!this.recorder) {
        return await run();
      }
      // DAR-110 연계: 마지막 성공시각·발행 건수를 CronRunLog 에 남긴다(빈 에디션=count 0 도 정상 성공).
      return await this.recorder.record(CRON_JOB_KEYS.EDITION_PUBLISH_PUSH, run, {
        countOf: (r) => (r.published ? r.count : 0),
      });
    } catch (err) {
      // recorder 가 FAILED 를 기록한 뒤 재던진 예외 — cron 스케줄 유지를 위해 흡수한다.
      this.logger.error('[EditionPush] 발행 푸시 실패(cron 유지)', err as Error);
      return null;
    } finally {
      this.isRunning = false;
    }
  }
}
