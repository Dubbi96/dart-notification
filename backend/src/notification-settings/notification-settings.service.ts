import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';

@Injectable()
export class NotificationSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(userId: string) {
    const settings = await this.prisma.notificationSettings.findUnique({
      where: { userId },
    });

    if (!settings) {
      // Create default settings if not found
      return this.prisma.notificationSettings.create({
        data: {
          userId,
          disclosureTypes: [],
          keywords: [],
          isEnabled: true,
        },
      });
    }

    return settings;
  }

  async update(userId: string, dto: UpdateNotificationSettingsDto) {
    const settings = await this.prisma.notificationSettings.upsert({
      where: { userId },
      update: dto,
      create: {
        userId,
        disclosureTypes: dto.disclosureTypes || [],
        keywords: dto.keywords || [],
        isEnabled: dto.isEnabled ?? true,
      },
    });

    return settings;
  }
}
