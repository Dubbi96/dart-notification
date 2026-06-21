import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StrategyTrackService, StrategyTrackRefreshSummary } from './strategy-track.service';
import { CronRunRecorderService } from '../../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../../cron-health/cron-health.jobs';
import { KST_TIMEZONE } from '../../../common/time/kst';

/**
 * StrategyTrackScheduler — DAR-404 전략 변형 4종 다중 트랙 1일 1회 갱신.
 *
 * 데이터(과거 공시 신호·일봉)가 늘면 트랙이 자동으로 더 깊은 표본을 반영하도록 매일 새벽 재산출한다.
 * 비교/거래내역 엔드포인트는 항상 최신 완료 트랙을 읽으므로, 갱신 한 번이 곧 화면 최신화다.
 *
 * ★멱등: refreshAll() 이 전략별 직전 run 을 새 run 성공 후 정리한다(최신 1개 유지).
 * ★throw 금지: cron 스케줄 유지를 위해 예외를 흡수한다(recorder 는 FAILED 기록).
 *
 * AI 금지영역: 리플레이·집계 전 구간 순수 Rule. AI 개입 0.
 */
@Injectable()
export class StrategyTrackScheduler {
  private readonly logger = new Logger(StrategyTrackScheduler.name);

  constructor(
    private readonly tracks: StrategyTrackService,
    // @Optional: CronHealthModule(@Global) 미등록 환경(일부 테스트)에서도 동작.
    @Optional() private readonly recorder?: CronRunRecorderService,
  ) {}

  /** 매일 05:00(KST) — 전략 변형 4종 트랙 재산출(off-hours·저부하). */
  @Cron('0 5 * * *', { timeZone: KST_TIMEZONE })
  async refreshDaily(): Promise<void> {
    this.logger.log('[StrategyTrack] 전략 변형 4종 다중 트랙 일일 갱신 시작');

    const run = () => this.tracks.refreshAll();

    try {
      if (!this.recorder) {
        await run();
        return;
      }
      // itemCount = 이번 갱신에서 COMPLETED 로 산출된 전략 트랙 수.
      await this.recorder.record(CRON_JOB_KEYS.STRATEGY_TRACK_REFRESH, run, {
        countOf: (r: StrategyTrackRefreshSummary) =>
          r.results.filter((x) => x.status === 'COMPLETED').length,
      });
    } catch (error) {
      this.logger.error('[StrategyTrack] 일일 갱신 오류', error);
    }
  }
}
