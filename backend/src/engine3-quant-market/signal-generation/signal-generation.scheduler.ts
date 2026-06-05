/**
 * 신호 생성 Cron 스케줄러 — DAR-41
 *
 * 시세 수집(KRX EOD 18:30) 이후, paper-sim(19:30) 이전인 평일 19:00 에
 * 대상 공시의 TradingSignal 을 생성한다. 멱등 — 중복 (rcpNo, persona) 미생성.
 *
 * AI 금지영역: BuyScore 계산 전 구간 순수 Rule.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  SignalGenerationService,
  SignalGenerationSummary,
} from './signal-generation.service';

@Injectable()
export class SignalGenerationScheduler {
  private readonly logger = new Logger(SignalGenerationScheduler.name);

  constructor(private readonly signalGen: SignalGenerationService) {}

  /** 평일 19:00 — 누락 신호 생성 (시세수집 18:30 이후·paper-sim 19:30 이전) */
  @Cron('0 19 * * 1-5')
  async generateDaily(): Promise<SignalGenerationSummary> {
    this.logger.log('[SignalGen] Cron 19:00 트리거');
    return this.signalGen.generateMissingSignals('CRON');
  }
}
