import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType } from '@prisma/client';
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
    const { userId, type, refId, title, body, deepLink, disclosureRcpNo } = input;

    const exists = await this.prisma.notificationHistory.findUnique({
      where: { userId_type_refId: { userId, type, refId } },
    });
    if (exists) return exists;

    return this.prisma.notificationHistory.create({
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
