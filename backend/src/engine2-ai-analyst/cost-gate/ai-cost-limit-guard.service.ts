import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AiCostLevel, AiCostLimitStatus } from '../types/ai-analyst.types';
import { kstDayStart, kstMonthStart } from '../../common/time/kst';

/**
 * 비용 예약 핸들 — enforceLimit가 반환한다.
 * - level: 한도 가드 적용 후 최종 레벨(초과 시 L0).
 * - settle(): 호출 완료(logUsage 직후) 시 **반드시** 호출해 인플라이트 예약을 해제한다.
 *   level이 L0(예약 미발생)이면 no-op이며, 중복 호출도 안전(멱등).
 */
export interface CostReservation {
  level: AiCostLevel;
  settle: () => void;
}

/**
 * AI 비용 한도 가드 — 순수 Rule (AI 미개입).
 * 일/월 누적 비용이 한도 초과 시 AiCostLevel.L0으로 강등한다.
 * phase-11 AI 비용 거버넌스 구현체.
 *
 * DAR-242: read-then-act 동시성 보호.
 *   기존엔 getLimitStatus(DB aggregate) 후 락·예약 없이 판정 → BullMQ 병렬 잡이
 *   한도 직전에 동시에 "미달"을 읽고 모두 유료 호출을 발사해 한도를 돌파했다
 *   (costUsd는 호출 후 logUsage라 진행 중 호출이 집계에 안 잡혀 창이 더 벌어짐).
 *   해결(plumbing, AI 무관):
 *     1) read+reserve를 인프로세스 뮤텍스로 직렬화 → 동시 판정 레이스 제거
 *        (cron/poller 인프로세스 락 선례: DAR-231/DAR-229와 동일 동시성 모델).
 *     2) 호출 전 보수적 예약(RESERVATION_USD)을 인메모리로 가산 → 진행 중(인플라이트)
 *        호출이 committed 집계에 잡히기 전에도 한도 판정에 반영. 호출 완료 후 settle()로
 *        해제하면 실비용은 이미 AIUsageLog(committed)에 반영돼 있다.
 *     판정식: committed + reserved(인플라이트) + RESERVATION_USD > limit → L0 차단.
 *   보장: 단일 호출 실비용 ≤ RESERVATION_USD인 한, 누적 committed는 한도를 넘지 않는다
 *   (실비용이 추정을 초과하면 1회분 만큼의 제한적 초과만 가능 — 기존의 무제한 N배
 *   돌파 대비 창을 결정적으로 축소).
 */
@Injectable()
export class AiCostLimitGuardService {
  static readonly DAILY_LIMIT_USD = 1.0;
  static readonly MONTHLY_LIMIT_USD = 20.0;

  /**
   * 호출당 보수적 예약 추정치(USD). 공시당 목표 비용(<$0.005)·단일 LLM 호출 실비용보다
   * 충분히 큰 상한이되, 인플라이트 동시 호출만큼만 예약을 점유하므로 정상 처리량을
   * 과도하게 throttling하지 않는 값. settle 후 실비용은 committed(AIUsageLog)로 반영된다.
   */
  static readonly RESERVATION_USD = 0.05;

  /** 현재 인플라이트(호출 진행 중) 예약 합계 — settle 시 차감된다. */
  private reservedDailyUsd = 0;
  private reservedMonthlyUsd = 0;

  /** read+reserve 임계구역 직렬화용 인프로세스 뮤텍스(프로미스 체인). */
  private mutex: Promise<void> = Promise.resolve();

  constructor(private readonly prisma: PrismaService) {}

  async getLimitStatus(): Promise<AiCostLimitStatus> {
    // 한도 윈도 경계는 KST 벽시계 자정/월초로 고정한다(DAR-243). createdAt은
    // Prisma 기본 UTC 저장이므로 로컬 TZ setHours/생성자로 만든 경계는 UTC
    // 컨테이너에서 9시간 어긋나 일/월 한도를 오산정한다.
    const now = new Date();
    const dayStart = kstDayStart(now);
    const monthStart = kstMonthStart(now);

    const [dailyAgg, monthlyAgg] = await Promise.all([
      this.prisma.aIUsageLog.aggregate({
        where: { createdAt: { gte: dayStart } },
        _sum: { costUsd: true },
      }),
      this.prisma.aIUsageLog.aggregate({
        where: { createdAt: { gte: monthStart } },
        _sum: { costUsd: true },
      }),
    ]);

    const dailyCostUsd = dailyAgg._sum.costUsd ?? 0;
    const monthlyCostUsd = monthlyAgg._sum.costUsd ?? 0;
    const dailyExceeded = dailyCostUsd >= AiCostLimitGuardService.DAILY_LIMIT_USD;
    const monthlyExceeded = monthlyCostUsd >= AiCostLimitGuardService.MONTHLY_LIMIT_USD;
    const forcedLevel = dailyExceeded || monthlyExceeded ? AiCostLevel.L0 : null;

    return {
      dailyCostUsd,
      dailyLimitUsd: AiCostLimitGuardService.DAILY_LIMIT_USD,
      dailyExceeded,
      monthlyCostUsd,
      monthlyLimitUsd: AiCostLimitGuardService.MONTHLY_LIMIT_USD,
      monthlyExceeded,
      forcedLevel,
    };
  }

  /**
   * 제안 레벨에 일/월 한도를 강제하고, 유료 호출 슬롯을 원자적으로 예약한다.
   * 반환된 CostReservation.settle()을 호출 완료(logUsage) 후 반드시 호출해야 한다.
   * 제안이 L0면 예약 없이 즉시 반환(no-op settle).
   */
  async enforceLimit(proposedLevel: AiCostLevel): Promise<CostReservation> {
    if (proposedLevel === AiCostLevel.L0) {
      return { level: AiCostLevel.L0, settle: () => {} };
    }

    return this.runExclusive(async () => {
      const status = await this.getLimitStatus();
      const reserve = AiCostLimitGuardService.RESERVATION_USD;
      const dailyProjected = status.dailyCostUsd + this.reservedDailyUsd + reserve;
      const monthlyProjected = status.monthlyCostUsd + this.reservedMonthlyUsd + reserve;
      const wouldExceed =
        dailyProjected > AiCostLimitGuardService.DAILY_LIMIT_USD ||
        monthlyProjected > AiCostLimitGuardService.MONTHLY_LIMIT_USD;

      if (status.forcedLevel !== null || wouldExceed) {
        return { level: AiCostLevel.L0, settle: () => {} };
      }

      // 예약 점유 — 인플라이트 호출이 committed에 잡히기 전까지 한도 판정에 반영된다.
      this.reservedDailyUsd += reserve;
      this.reservedMonthlyUsd += reserve;
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        this.reservedDailyUsd -= reserve;
        this.reservedMonthlyUsd -= reserve;
      };
      return { level: proposedLevel, settle };
    });
  }

  /**
   * 인프로세스 뮤텍스로 임계구역을 직렬화한다(read+reserve 원자성).
   * 프로미스 체인 관용구 — 이전 작업이 끝난 뒤에야 다음 작업이 진입한다.
   */
  private async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.mutex;
    let release!: () => void;
    this.mutex = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}
