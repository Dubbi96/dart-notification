import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { KST_TIMEZONE } from '../../common/time/kst';
import { AiCostHealthService } from './ai-cost-health.service';
import { AiCostHealthSnapshot } from '../types/ai-analyst.types';
import { NotificationProducerService } from '../../notifications/notification-producer.service';

/**
 * AiCostMonitorScheduler — 일일 AI 비용게이트 상시 모니터링 Cron (DAR-75).
 *
 * 매일 1회 과거 AIUsageLog 집계로 수용 기준(비용·L0비율)·한도 충족 여부를 산출한다.
 * ★알림 플래그는 로그/응답/OPS_ALERT 통지 전용 — 실주문·Kill Switch에 직접 연결하지 않는다
 *   (휴먼 승인 경계, DAR-476 P02 는 관측·알림층만 추가하고 자동 조치는 추가하지 않는다).
 * LLM_API_KEY 미설정이어도 health 집계는 DB 기반이라 graceful하게 동작한다.
 */
@Injectable()
export class AiCostMonitorScheduler {
  private readonly logger = new Logger(AiCostMonitorScheduler.name);

  constructor(
    private readonly health: AiCostHealthService,
    private readonly producer: NotificationProducerService,
  ) {}

  /** 매일 09:00(KST) — 전일까지 누적 비용 상시 가드 */
  @Cron('0 9 * * *', { timeZone: KST_TIMEZONE })
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
      // DAR-476(P02): 위반 시 OPS_ALERT 발송(첫 연결 후보). 일 1회 잡이라 자연히 디바운스되며,
      //   dedupeKey 에 날짜 버킷을 넣어 동일 일자 재실행 중복을 억제. 자동 조치 없음(관측·알림만).
      void this.producer.enqueueOpsAlert(
        'WARNING',
        'ai-cost-monitor',
        `AI 비용 수용기준/한도 위반 — ${snapshot.alert.reasons.join('; ')}`,
        {
          dedupeKey: `ai-cost-monitor:violation:${snapshot.evaluatedAt.slice(0, 10)}`,
          deepLink: '/settings-detail/ai-cost',
          data: {
            evaluatedAt: snapshot.evaluatedAt,
            reasons: snapshot.alert.reasons,
            dailyCostUsd: snapshot.daily.totalCostUsd,
            dailyUsedRatio: snapshot.limitUsage.dailyUsedRatio,
          },
        },
      );
    }
    return snapshot;
  }
}
