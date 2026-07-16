import { Injectable, Logger } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import type { PushDeliveryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { formatKstDateCompact } from '../common/time/kst';

/**
 * PushDeliveryStatus enum 런타임 값(SSOT). 스키마 enum 과 1:1(값=DB 저장 문자열).
 *   ★`@prisma/client` 래퍼가 신규 enum 의 런타임 re-export 를 일부 실행환경(jest 리졸버)에서
 *   누락하는 CJS 상호운용 함정을 피하려고, 타입 바인딩(`satisfies`)된 문자열 상수로 직접 둔다.
 *   Prisma enum 컬럼은 이 문자열을 그대로 수용하므로 프로덕션 동작은 동일하다.
 */
export const PUSH_DELIVERY_STATUS = {
  SENT: 'SENT',
  SUPPRESSED_CAP: 'SUPPRESSED_CAP',
} as const satisfies Record<string, PushDeliveryStatus>;

/**
 * DAR-514(Wave A): 사용자별 일일 푸시 캡 — 발송 억제 + 억제 로그(수용기준 2).
 *
 * 캡은 '피로 방지'용 소프트 상한이다. 실발송 직전(계열 토글·master·유효토큰 통과 후)에
 * consume() 를 부르면, 당일(KST) SENT 카운트가 캡 미만이면 SENT 원장을 남기고 통과시키고,
 * 캡 이상이면 SUPPRESSED_CAP 원장을 남기고 억제한다. 인박스(NotificationHistory)는 캡과
 * 무관하게 이미 기록되어 있으므로, 억제되어도 사용자는 앱에서 해당 통지를 볼 수 있다
 * (억제되는 것은 '푸시 배너'뿐 — 정보 손실 아님).
 */

/** 설정행 미존재/미설정 시 적용할 기본 일일 캡. 보수적 상한(정상 알림량은 밑돌되 폭주만 차단). */
export const DEFAULT_DAILY_PUSH_CAP = 30;
/** dailyPushCap 허용 범위(DTO 검증과 동형). 0(전량 뮤트)은 master isEnabled 로 표현한다. */
export const MIN_DAILY_PUSH_CAP = 1;
export const MAX_DAILY_PUSH_CAP = 500;

/**
 * 캡 면제 계열 — 리스크·운영 알림(RISK_ALERT/OPS_ALERT).
 * 킬스위치·크론 stale 등 안전·운영 신호를 피로 방지 캡으로 은닉하면 안 된다(정직·안전).
 * 면제 계열은 캡에 계상되지도, 캡에 의해 억제되지도 않는다(직교) — 호출측이 consume 을
 * 애초에 부르지 않는다.
 */
export const CAP_EXEMPT_TYPES: ReadonlySet<NotificationType> = new Set<NotificationType>([
  NotificationType.RISK_ALERT,
  NotificationType.OPS_ALERT,
]);

/** 캡 면제 계열 여부(발송 경로가 consume 을 부를지 결정하는 순수 술어). */
export function isCapExemptType(type: NotificationType): boolean {
  return CAP_EXEMPT_TYPES.has(type);
}

export interface CapDecision {
  /** 실발송 허용 여부(캡 이내). */
  allowed: boolean;
  /** 적용된 일일 캡 값. */
  cap: number;
  /** 이 결정 시점의 당일 SENT 카운트. */
  sentToday: number;
  /** 이번 호출로 새로 억제(SUPPRESSED_CAP)했는가. */
  suppressed: boolean;
}

@Injectable()
export class PushCapService {
  private readonly logger = new Logger(PushCapService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 일일 캡을 소비한다 — 캡 이내면 SENT 원장 후 allowed=true, 초과면 SUPPRESSED_CAP 원장 후
   * allowed=false. (userId,type,refId) 멱등: 이미 결정된 통지는 원장 상태를 재사용한다
   * (잡 재시도에도 이중 계상/이중 억제 0). NotificationHistory 멱등키와 동형이라 인박스 1건당
   * 원장 1건이 대응한다.
   *
   * 동시성: countSentToday→create 는 check-then-act 라, 서로 다른 refId 의 동시 소비가 캡
   * 경계에서 각자 통과해 캡을 소폭 초과할 수 있다(소프트 상한 — 하드 원자성 불요). 같은 refId
   * 경합은 @@unique + P2002 흡수로 정확히 1행만 남는다(이중 카운트 0).
   *
   * @param now 결정론 테스트용 주입 시각(기본 현재). KST 일자 버킷 계산에만 쓴다.
   */
  async consume(
    userId: string,
    type: NotificationType,
    refId: string,
    now: Date = new Date(),
  ): Promise<CapDecision> {
    const kstDate = formatKstDateCompact(now);
    const cap = await this.resolveCap(userId);

    // 멱등: 이미 기록된 통지면 그 결정을 그대로 재사용(중복 카운트/억제 방지).
    const existing = await this.prisma.pushDeliveryLog.findUnique({
      where: { userId_type_refId: { userId, type, refId } },
    });
    if (existing) {
      return {
        allowed: existing.status === PUSH_DELIVERY_STATUS.SENT,
        cap,
        sentToday: await this.countSentToday(userId, kstDate),
        suppressed: false,
      };
    }

    const sentToday = await this.countSentToday(userId, kstDate);
    const status =
      sentToday < cap ? PUSH_DELIVERY_STATUS.SENT : PUSH_DELIVERY_STATUS.SUPPRESSED_CAP;

    try {
      await this.prisma.pushDeliveryLog.create({
        data: { userId, type, refId, kstDate, status },
      });
    } catch (err) {
      // 동시 소비 경합(P2002) — 승자의 결정을 재조회해 멱등 흡수(중복 카운트 0).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.prisma.pushDeliveryLog.findUnique({
          where: { userId_type_refId: { userId, type, refId } },
        });
        if (winner) {
          return {
            allowed: winner.status === PUSH_DELIVERY_STATUS.SENT,
            cap,
            sentToday,
            suppressed: false,
          };
        }
      }
      throw err;
    }

    const allowed = status === PUSH_DELIVERY_STATUS.SENT;
    if (!allowed) {
      this.logger.log(
        `[PUSH-CAP] 일일 캡 초과 억제: user=${userId} type=${type} ref=${refId} (${sentToday}/${cap})`,
      );
    }
    return { allowed, cap, sentToday, suppressed: !allowed };
  }

  /** 당일(KST) 발송/억제 관측치 — 설정 센터의 '오늘 발송량' 표시·감사용(읽기 전용). */
  async getUsage(
    userId: string,
    now: Date = new Date(),
  ): Promise<{ sent: number; suppressed: number; cap: number }> {
    const kstDate = formatKstDateCompact(now);
    const [sent, suppressed, cap] = await Promise.all([
      this.prisma.pushDeliveryLog.count({
        where: { userId, kstDate, status: PUSH_DELIVERY_STATUS.SENT },
      }),
      this.prisma.pushDeliveryLog.count({
        where: { userId, kstDate, status: PUSH_DELIVERY_STATUS.SUPPRESSED_CAP },
      }),
      this.resolveCap(userId),
    ]);
    return { sent, suppressed, cap };
  }

  private async countSentToday(userId: string, kstDate: string): Promise<number> {
    return this.prisma.pushDeliveryLog.count({
      where: { userId, kstDate, status: PUSH_DELIVERY_STATUS.SENT },
    });
  }

  private async resolveCap(userId: string): Promise<number> {
    const settings = await this.prisma.notificationSettings.findUnique({
      where: { userId },
      select: { dailyPushCap: true },
    });
    return settings?.dailyPushCap ?? DEFAULT_DAILY_PUSH_CAP;
  }
}
