import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { NotificationType, NotificationHistory, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryNotificationDto } from './dto/query-notification.dto';
import {
  NotificationCategory,
  NOTIFICATION_CATEGORY,
  CATEGORY_TYPES,
} from './notification-category';

/**
 * 통합 알림 생성 입력 (DAR-84)
 * 공시(DISCLOSURE) 외 SIGNAL/EXIT/THESIS_VIOLATED 통지를 한 인박스로 수용.
 * refId는 다형 참조키(rcpNo/signalId/positionId) — DB FK 미강결합, 앱레벨 멱등.
 */
export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  refId: string;
  title?: string;
  body?: string;
  deepLink?: string;
  /** 공시 타입일 때만 채움 (FK 조인용). 공시 외 타입은 미지정. */
  disclosureRcpNo?: string;
}

/** DAR-563: notificationsLastSeenAt 미방문(null) 사용자 — 전체 이력을 신규로 취급하는 기준점. */
const NEVER_SEEN = new Date(0);

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 통합 인박스 알림 생성 — (userId, type, refId) 멱등.
   * 동일 키가 이미 있으면 기존 행을 반환(중복 통지 0). DAR-85 실발송 파이프라인의 토대.
   */
  async createNotification(input: CreateNotificationInput) {
    const { notification } = await this.createNotificationIfAbsent(input);
    return notification;
  }

  /**
   * createNotification 의 멱등 변형 — 신규 생성 여부(created)를 함께 반환한다.
   *
   * DAR-136: NotificationHistory(인박스) 를 **푸시 발송의 멱등 권위**로 승격하기 위함.
   * 동일 (userId,type,refId) 가 이미 있으면 created=false → 호출측(NotifyConsumer)이
   * 푸시 재발송을 건너뛴다. BullMQ 잡 재시도(attempts:3)가 부분 실패 후 재실행돼도
   * 이미 통지된 사용자에게 **중복 푸시가 가지 않도록** 보장한다(인박스 중복 0 + 푸시 중복 0).
   *
   * DAR-425: 위 findUnique→create 는 check-then-act 라 동시 잡(브로드캐스트 사이클 겹침·
   * 잡 동시 처리)에서 둘 다 exists=null 을 본 뒤 둘 다 create 를 시도할 수 있다(TOCTOU).
   * @@unique([userId, type, refId]) DB 제약이 이를 막지만, 진 쪽 create 는 P2002 로 throw 되어
   * 잡이 불필요하게 실패·재시도된다. 여기서 P2002 를 **멱등 성공**으로 흡수해 기존 행을 재조회·
   * created=false 로 반환한다(=upsert/skipDuplicates 등가). 이로써 동일 (userId,type,refId) 는
   * 경합 하에서도 정확히 1 행만 남는다(중복 인박스 0 보장이 check-then-act → 원자 등가로 강화).
   */
  async createNotificationIfAbsent(
    input: CreateNotificationInput,
  ): Promise<{ notification: NotificationHistory; created: boolean }> {
    const { userId, type, refId, title, body, deepLink, disclosureRcpNo } = input;

    const exists = await this.prisma.notificationHistory.findUnique({
      where: { userId_type_refId: { userId, type, refId } },
    });
    if (exists) return { notification: exists, created: false };

    try {
      const notification = await this.prisma.notificationHistory.create({
        data: {
          userId,
          type,
          refId,
          title: title ?? null,
          body: body ?? null,
          deepLink: deepLink ?? null,
          disclosureRcpNo:
            type === NotificationType.DISCLOSURE ? (disclosureRcpNo ?? refId) : null,
        },
      });
      return { notification, created: true };
    } catch (err) {
      // DAR-425: 경합 패자의 unique 위반(P2002) 은 '이미 누가 통지함' 과 동치 → 멱등 성공.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const winner = await this.prisma.notificationHistory.findUnique({
          where: { userId_type_refId: { userId, type, refId } },
        });
        if (winner) {
          this.logger.debug(
            `[NOTIFY] 동시 생성 경합(P2002) 멱등 흡수: user=${userId} type=${type} ref=${refId}`,
          );
          return { notification: winner, created: false };
        }
      }
      throw err;
    }
  }

  /**
   * DAR-259: 푸시 발송 실패 시 직전 createNotificationIfAbsent 로 만든 인박스 행을 롤백한다.
   *
   * 인박스 행이 사라지면 다음 폴링의 createNotificationIfAbsent 가 다시 created=true 로
   * 재생성 → 푸시 재발송된다(발송 성공분은 created=false 로 스킵돼 중복 0). 즉 인박스를
   * '푸시 발송의 멱등 권위'로 쓰되, 발송이 끝까지 실패한 건만 권위를 되돌려 재발송 기회를
   * 남긴다. deleteMany 라 이미 사라진 행(동시 폴링 등)이어도 throw 하지 않는다(멱등 롤백).
   */
  async rollbackNotification(id: string): Promise<void> {
    await this.prisma.notificationHistory.deleteMany({ where: { id } });
  }

  async findAll(userId: string, query: QueryNotificationDto) {
    const { page = 1, limit = 20, isRead, type, category } = query;

    const where: any = { userId };
    if (isRead !== undefined) {
      where.isRead = isRead === 'true';
    }
    // DAR-430: 카테고리 필터(공시/신호/체결) 우선 — 여러 타입을 한 버킷으로 묶어 조회.
    // DAR-161: 단일 타입 필터(하위호환). category 미지정 시에만 적용.
    if (category !== undefined) {
      where.type = { in: CATEGORY_TYPES[category] };
    } else if (type !== undefined) {
      where.type = type;
    }

    // DAR-563: 뱃지 기준을 isRead(행별 읽음)에서 seen 마커로 분리 — '탭 방문 이후 신규 생성분'만
    // 뱃지로 센다. isRead 는 그대로 findAll 필터·markAsRead/markAllAsRead 하이라이트 용도로 남는다.
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { notificationsLastSeenAt: true },
    });
    const unseenSince = user?.notificationsLastSeenAt ?? NEVER_SEEN;

    const [items, total, unreadCount, unreadByTypeRows] = await Promise.all([
      this.prisma.notificationHistory.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        // DAR-289: sentAt 은 배치 발송 시 동값 가능 → 유니크 id 로 tie-break(페이지 경계 안정화)
        orderBy: [{ sentAt: 'desc' }, { id: 'desc' }],
        include: {
          disclosure: {
            select: {
              rcpNo: true,
              corpCode: true,
              corpName: true,
              reportName: true,
              disclosureType: true,
            },
          },
        },
      }),
      this.prisma.notificationHistory.count({ where }),
      this.prisma.notificationHistory.count({
        where: { userId, sentAt: { gt: unseenSince } },
      }),
      // DAR-161: 타입별 뱃지 카운트 — 타입 필터와 무관하게 사용자 전체 기준으로 집계
      // (세그먼트 칩의 타입별 배지가 현재 선택 필터에 영향받지 않도록).
      this.prisma.notificationHistory.groupBy({
        by: ['type'],
        where: { userId, sentAt: { gt: unseenSince } },
        _count: { _all: true },
      }),
    ]);

    // 모든 타입 키를 0으로 초기화한 뒤 집계행으로 덮어써 누락 키 없이 안정적 맵 반환.
    const unreadByType: Record<NotificationType, number> = {
      [NotificationType.DISCLOSURE]: 0,
      [NotificationType.SIGNAL]: 0,
      [NotificationType.EXIT]: 0,
      [NotificationType.THESIS_VIOLATED]: 0,
      // DAR-424: 라이브 페이퍼 체결 알림 타입.
      [NotificationType.TRADE_ENTRY]: 0,
      [NotificationType.TRADE_EXIT]: 0,
      // DAR-473(P01): 리스크·운영 알림 타입.
      [NotificationType.RISK_ALERT]: 0,
      [NotificationType.OPS_ALERT]: 0,
      // 갭분석 W7: 관심종목 급변동 알림 타입.
      [NotificationType.PRICE_MOVE]: 0,
      // DAR-523: 일일 에디션 발행 알림 타입.
      [NotificationType.EDITION]: 0,
    };
    for (const row of unreadByTypeRows) {
      unreadByType[row.type] = row._count._all;
    }

    // DAR-430: 카테고리(3 버킷)별 미읽음 — 타입별 집계를 카테고리로 합산(필터칩 배지용).
    const unreadByCategory: Record<NotificationCategory, number> = {
      disclosure: 0,
      signal: 0,
      trade: 0,
      // DAR-473(P01): 운영 버킷.
      system: 0,
    };
    for (const t of Object.keys(unreadByType) as NotificationType[]) {
      unreadByCategory[NOTIFICATION_CATEGORY[t]] += unreadByType[t];
    }

    return {
      items,
      meta: {
        page,
        limit,
        total,
        unreadCount,
        unreadByType,
        unreadByCategory,
      },
    };
  }

  /**
   * DAR-563: 알림탭 seen 마커 갱신 — findAll 뱃지(sentAt > notificationsLastSeenAt) 계산의 기준점.
   * isRead(행별 읽음)는 별개 — 하이라이트는 markAsRead/markAllAsRead 로만 바뀐다.
   */
  async markSeen(userId: string): Promise<{ notificationsLastSeenAt: string }> {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { notificationsLastSeenAt: new Date() },
      select: { notificationsLastSeenAt: true },
    });
    return { notificationsLastSeenAt: updated.notificationsLastSeenAt!.toISOString() };
  }

  async markAsRead(userId: string, id: string) {
    const notification = await this.prisma.notificationHistory.findFirst({
      where: { id, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    const updated = await this.prisma.notificationHistory.update({
      where: { id },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return updated;
  }

  async markAllAsRead(userId: string) {
    const result = await this.prisma.notificationHistory.updateMany({
      where: { userId, isRead: false },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    });

    return { updatedCount: result.count };
  }

  async remove(userId: string, id: string) {
    const notification = await this.prisma.notificationHistory.findFirst({
      where: { id, userId },
    });

    if (!notification) {
      throw new NotFoundException('Notification not found');
    }

    await this.prisma.notificationHistory.delete({
      where: { id },
    });
  }
}
