import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  async register(userId: string, dto: RegisterDeviceDto) {
    const device = await this.prisma.userDevice.upsert({
      where: { deviceToken: dto.deviceToken },
      update: {
        userId,
        platform: dto.platform,
      },
      create: {
        userId,
        deviceToken: dto.deviceToken,
        platform: dto.platform,
      },
    });

    return device;
  }

  async remove(userId: string, deviceId: string) {
    await this.prisma.userDevice.deleteMany({
      where: { id: deviceId, userId },
    });
  }

  async removeByToken(userId: string, deviceToken: string) {
    await this.prisma.userDevice.deleteMany({
      where: { userId, deviceToken },
    });
  }

  async removeByDeviceToken(deviceToken: string) {
    await this.prisma.userDevice.deleteMany({
      where: { deviceToken },
    });
  }
}
