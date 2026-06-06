import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AiCostHealthService } from './ai-cost-health.service';
import { AiCostHealthSnapshot } from '../types/ai-analyst.types';

/**
 * AiCostMonitorScheduler — 일일 AI 비용게이트 상시 모니터링 Cron (DAR-75).
 *
 * 매일 1회 과거 AIUsageLog 집계로 수용 기준(비용·L0비율)·한도 충족 여부를 산출한다.
 * ★알림 플래그는 로그/응답 전용 — 실주문·Kill Switch에 직접 연결하지 않는다(휴먼 승인 경계).
 * LLM_API_KEY 미설정이어도 health 집계는 DB 기반이라 graceful하게 동작한다.
 */
@Injectable()
export class AiCostMonitorScheduler {
  private readonly logger = new Logger(AiCostMonitorScheduler.name);

  constructor(private readonly health: AiCostHealthService) {}

  /** 매일 09:00 — 전일까지 누적 비용 상시 가드 */
  @Cron('0 9 * * *')
  async runDaily(): Promise<AiCostHealthSnapshot> {
    const snapshot = await this.health.getHealth();
    this.logger.log(
      `[AiCostMonitor] daily=$${snapshot.daily.totalCostUsd.toFixed(4)} ` +
        `weekL0=${(snapshot.weekly.l0Ratio * 100).toFixed(0)}% ` +
        `costPerDisc=$${snapshot.acceptance.costPerDisclosureUsd.toFixed(5)} ` +
        `dailyUse=${(snapshot.limitUsage.dailyUsedRatio * 100).toFixed(0)}% ` +
        `keyConfigured=${snapshot.llmKeyConfigured}`,
    );
    if (snapshot.alert.violated) {
      // 운영 알림 플래그 — 자동 조치 없음(휴먼 승인 경계).
      this.logger.warn(
        `[AiCostMonitor] 수용기준/한도 위반 — ${snapshot.alert.reasons.join('; ')} ` +
          `(운영 알림 플래그, 자동 주문·Kill 연결 없음)`,
      );
    }
    return snapshot;
  }
}
