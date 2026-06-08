/**
 * 신호 생성 Cron 스케줄러 — DAR-41
 *
 * 시세 수집(KRX EOD 18:30) 이후, paper-sim(19:30) 이전인 평일 19:00 에
 * 대상 공시의 TradingSignal 을 생성한다. 멱등(DAR-125) — 자연키
 * (corpCode, rcpNo, eventType, persona) upsert 로 중복 미생성.
 *
 * AI 금지영역: BuyScore 계산 전 구간 순수 Rule.
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  SignalGenerationService,
  SignalGenerationSummary,
} from './signal-generation.service';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';

@Injectable()
export class SignalGenerationScheduler {
  private readonly logger = new Logger(SignalGenerationScheduler.name);

  constructor(
    private readonly signalGen: SignalGenerationService,
    // @Optional: CronHealthModule 미등록 환경(일부 테스트)에서도 동작. 미주입 시 기록만 생략.
    @Optional() private readonly recorder?: CronRunRecorderService,
  ) {}

  /** 평일 19:00 — 누락 신호 생성 (시세수집 18:30 이후·paper-sim 19:30 이전) */
  @Cron('0 19 * * 1-5')
  async generateDaily(): Promise<SignalGenerationSummary> {
    this.logger.log('[SignalGen] Cron 19:00 트리거');
    const run = () => this.signalGen.generateMissingSignals('CRON');
    if (!this.recorder) return run();
    // DAR-110: 마지막 성공시각/생성건수 기록(신선도 판정 입력). 생성 0도 정상 성공.
    return this.recorder.record(CRON_JOB_KEYS.SIGNAL_GENERATE, run, {
      countOf: (r) => r.created,
    });
  }
}
