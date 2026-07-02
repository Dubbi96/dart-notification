/**
 * ForwardTracksScheduler — 철학 스타일 4트랙 + 전략 변형 4종 forward 일일 사이클 Cron (live-readiness W1)
 *
 * ★진단 확정 결함 교정: 철학 스타일 시뮬(DAR-76)은 수동 run-once 경로만 있고 크론 배선이 없어
 *   4트랙이 미가동 상태였다(persona/스타일 비교 화면 정체). 전략 4종은 리플레이만 있고 forward 가
 *   없었다. 이 스케줄러가 두 축을 평일 저녁(시세·신호 수집 완료 후) 자동 발화시킨다.
 *
 * - 19:40 KST: 철학 스타일 4트랙(시스템 모의 19:30 직후 — 동일 시세 기준·부하 분산).
 * - 19:45 KST: 전략 변형 4종 forward(스타일 사이클 직후 직렬화 — PaperTrade 경합 최소화).
 *
 * AI 금지영역: 스케줄러는 트리거만 — 점수·체결 결정 없음(PaperSimulationScheduler 패턴 계승).
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  PhilosophyStyleSimulationService,
  AllStylesCycleResult,
} from './philosophy-style-simulation.service';
import {
  StrategyForwardSimulationService,
  AllStrategiesCycleResult,
} from './strategy-forward-simulation.service';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';
import { KST_TIMEZONE, formatKstDateCompact } from '../../common/time/kst';

@Injectable()
export class ForwardTracksScheduler {
  private readonly logger = new Logger(ForwardTracksScheduler.name);

  constructor(
    private readonly styleSim: PhilosophyStyleSimulationService,
    private readonly strategySim: StrategyForwardSimulationService,
    // @Optional: CronHealthModule 미등록 환경(일부 테스트)에서도 동작. 미주입 시 기록만 생략.
    @Optional() private readonly recorder?: CronRunRecorderService,
  ) {}

  /** 평일 19:40(KST) — 시스템 모의(19:30) 직후 철학 스타일 4트랙 1사이클. */
  @Cron('40 19 * * 1-5', { timeZone: KST_TIMEZONE })
  async runStyleDaily(): Promise<AllStylesCycleResult> {
    const tradeDate = this.todayBasDd();
    this.logger.log(`[ForwardTracks][Cron] 철학 스타일 4트랙 실행 tradeDate=${tradeDate}`);
    const run = () => this.styleSim.runDailyCycleAllStyles(tradeDate);
    if (!this.recorder) return run();
    // 신선도 판정 입력 — itemCount = 스타일 합산 스냅샷 건수(가동 증거).
    return this.recorder.record(CRON_JOB_KEYS.STYLE_SIMULATION, run, {
      countOf: (r) => r.styles.reduce((s, x) => s + x.snapshotted, 0),
    });
  }

  /** 평일 19:45(KST) — 스타일 사이클 직후 전략 변형 4종 forward 1사이클. */
  @Cron('45 19 * * 1-5', { timeZone: KST_TIMEZONE })
  async runStrategyDaily(): Promise<AllStrategiesCycleResult> {
    const tradeDate = this.todayBasDd();
    this.logger.log(`[ForwardTracks][Cron] 전략 forward 4트랙 실행 tradeDate=${tradeDate}`);
    const run = () => this.strategySim.runDailyCycleAllStrategies(tradeDate);
    if (!this.recorder) return run();
    return this.recorder.record(CRON_JOB_KEYS.STRATEGY_FORWARD, run, {
      countOf: (r) => r.strategies.reduce((s, x) => s + x.snapshotted, 0),
    });
  }

  /** 오늘 거래일 YYYYMMDD(KST). 시스템 TZ 무관 — UTC 새벽 전일 반환 방지(DAR-199 계승). */
  private todayBasDd(): string {
    return formatKstDateCompact(new Date());
  }
}
