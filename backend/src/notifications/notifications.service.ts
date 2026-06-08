import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType, NotificationHistory } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { QueryNotificationDto } from './dto/query-notification.dto';

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

@Injectable()
export class NotificationsService {
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
   */
  async createNotificationIfAbsent(
    input: CreateNotificationInput,
  ): Promise<{ notification: NotificationHistory; created: boolean }> {
    const { userId, type, refId, title, body, deepLink, disclosureRcpNo } = input;

    const exists = await this.prisma.notificationHistory.findUnique({
      where: { userId_type_refId: { userId, type, refId } },
    });
    if (exists) return { notification: exists, created: false };

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
  }

  async findAll(userId: string, query: QueryNotificationDto) {
    const { page = 1, limit = 20, isRead } = query;

    const where: any = { userId };
    if (isRead !== undefined) {
      where.isRead = isRead === 'true';
    }

    const [items, total, unreadCount] = await Promise.all([
      this.prisma.notificationHistory.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { sentAt: 'desc' },
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
        where: { userId, isRead: false },
      }),
    ]);

    return {
      items,
      meta: {
        page,
        limit,
        total,
        unreadCount,
      },
    };
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
