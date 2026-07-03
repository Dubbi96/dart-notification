/**
 * DualMomentumForwardScheduler — 듀얼모멘텀 코어 forward 트랙 일일 사이클 Cron (DAR-494 [견고화 W1·P13])
 *
 * 평일 19:50 KST 매일 발화한다(기존 forward 슬롯 19:40 스타일·19:45 전략 이후로 분리 — PaperTrade
 * 경합 없음·ETF 일봉 수집 19:10 이후). 월말 판정 발화 여부는 서비스가 P09 lastTradingDayOfMonth
 * (+당일 ETF 데이터 존재)로 게이트한다 — nest cron 'L'(월 마지막일) 미지원 우회.
 *
 * ★AI 금지영역: 스케줄러는 트리거만 — 점수·체결·판정 결정 없음(ForwardTracksScheduler 패턴 계승).
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  DualMomentumForwardService,
  DualMomentumForwardCycleResult,
} from './dual-momentum-forward.service';
import { CronRunRecorderService } from '../../../cron-health/cron-run-recorder.service';
import { CRON_JOB_KEYS } from '../../../cron-health/cron-health.jobs';
import { KST_TIMEZONE, formatKstDateCompact } from '../../../common/time/kst';

@Injectable()
export class DualMomentumForwardScheduler {
  private readonly logger = new Logger(DualMomentumForwardScheduler.name);

  constructor(
    private readonly service: DualMomentumForwardService,
    // @Optional: CronHealthModule 미등록 환경(일부 테스트)에서도 동작. 미주입 시 기록만 생략.
    @Optional() private readonly recorder?: CronRunRecorderService,
  ) {}

  /** 평일 19:50(KST) — 코어 forward 1사이클(예약 체결 → 월말 판정·예약 → 평가 스냅샷). */
  @Cron('50 19 * * 1-5', { timeZone: KST_TIMEZONE })
  async runDaily(): Promise<DualMomentumForwardCycleResult> {
    const tradeDate = formatKstDateCompact(new Date());
    this.logger.log(`[DualMomFwd][Cron] 코어 forward 실행 tradeDate=${tradeDate}`);
    const run = () => this.service.runDailyCycle(tradeDate);
    if (!this.recorder) return run();
    // 신선도 판정 입력 — itemCount = 이 사이클 체결 건수(가동 증거·0도 정상 no-op).
    return this.recorder.record(CRON_JOB_KEYS.DUAL_MOMENTUM_FORWARD, run, {
      countOf: (r) => r.filled,
    });
  }
}
