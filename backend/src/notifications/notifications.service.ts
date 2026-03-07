import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QueryNotificationDto } from './dto/query-notification.dto';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

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
