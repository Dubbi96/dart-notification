import { BadRequestException, Injectable } from '@nestjs/common';
import Expo from 'expo-server-sdk';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDeviceDto } from './dto/register-device.dto';

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  async register(userId: string, dto: RegisterDeviceDto) {
    // ★DAR-136: Expo 토큰 형식 검증 — 형식이 깨진 토큰은 DB에 저장하지 않는다.
    // 발송 경로(sendPush/matchAndNotify)도 무효 토큰을 거르지만, 등록 시점에서
    // 차단해 device 테이블에 쓰레기 토큰이 누적되지 않게 한다(토큰 위생).
    if (!Expo.isExpoPushToken(dto.deviceToken)) {
      throw new BadRequestException('유효하지 않은 Expo 푸시 토큰 형식입니다.');
    }

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
