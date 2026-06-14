import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  EventStudyCalculationService,
  EventStudyCalcSummary,
} from './event-study-calculation.service';
import { CronRunRecorderService } from '../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../cron-health/cron-health.jobs';
import { KST_TIMEZONE } from '../../common/time/kst';

/**
 * EventStudyCalculationScheduler — DAR-134 (신호 등급 전부 WATCH 근본 보정)
 *
 * ★근본원인: DAR-133 이 EventStudyCalculationService(산출 경로)를 추가했으나
 *   호출 트리거가 수동 POST /event-study/calculate 뿐 — cron 부재였다. 결과적으로
 *   라이브에서 EventStudyResult 가 채워지지 않아 Buy Score 의 historicalEvent 버킷이
 *   영구 결측(재정규화 제외) → 강한 양(+) 공시조차 55~59 에 정체, BUY(≥60) 미달로
 *   "전부 관망(WATCH)" 분포가 고착되었다(진단: buy-signal-distribution.diagnostic.spec).
 *
 * 본 스케줄러는 주간(토 04:00) EventStudyCalculationService.run() 으로 baseline 을
 * 재산출해 EventStudyResult(READY) 를 영속한다. 이후 평일 19:00 신호 생성이 이 결과를
 * historicalEvent 입력으로 결합 → 통계적으로 유의한 양(+) 초과수익 이벤트가 임계
 * 인하 없이 자연스럽게 상향된다. ★임계값(80/60/30) 불변 — 정직 원칙 준수.
 *
 * ★멱등: run() 은 (eventType::marketType::bucketKey) upsert (반복 무해).
 * ★격리: D+20 미성숙 관측은 자동 제외(라이브 미래값 오염 없음, DAR-133).
 * ★throw 금지: cron 스케줄 유지를 위해 예외를 흡수한다(recorder 는 FAILED 기록).
 *
 * AI 금지영역: Event Study 집계·Buy Score 결합 전 구간 순수 Rule.
 */
@Injectable()
export class EventStudyCalculationScheduler {
  private readonly logger = new Logger(EventStudyCalculationScheduler.name);

  constructor(
    private readonly calc: EventStudyCalculationService,
    // @Optional: CronHealthModule(@Global) 미등록 환경(일부 테스트)에서도 동작.
    @Optional() private readonly recorder?: CronRunRecorderService,
  ) {}

  /** 주간 토요일 04:00(KST) — Event Study baseline 전체 재산출(off-hours·저부하). */
  @Cron('0 4 * * 6', { timeZone: KST_TIMEZONE })
  async calculateWeekly(): Promise<void> {
    this.logger.log('[EventStudy] 주간 baseline 산출 스케줄러 실행');

    const run = () => this.calc.run();

    try {
      if (!this.recorder) {
        await run();
        return;
      }
      // DAR-110 연계: 마지막 성공시각/산출건수 기록(신선도 판정 입력).
      // itemCount = 이번 산출에서 READY 로 영속된 버킷 수(표본≥30·유의).
      await this.recorder.record(CRON_JOB_KEYS.EVENT_STUDY_CALC, run, {
        countOf: (r: EventStudyCalcSummary) => r.readyCount,
      });
    } catch (error) {
      this.logger.error('[EventStudy] 주간 baseline 산출 오류', error);
    }
  }
}
