import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { NotificationSettingsService } from './notification-settings.service';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';
import { PushCapService } from '../notifications/push-cap.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Notification Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notification-settings')
export class NotificationSettingsController {
  constructor(
    private readonly notificationSettingsService: NotificationSettingsService,
    // DAR-514: 설정 조회 시 '오늘 발송/억제/캡' 관측치를 함께 노출(설정 센터 표시용).
    private readonly pushCap: PushCapService,
  ) {}

  @Get()
  @ApiOperation({ summary: '알림 설정 조회' })
  async findOne(@CurrentUser('id') userId: string) {
    const [settings, pushUsage] = await Promise.all([
      this.notificationSettingsService.findByUserId(userId),
      this.pushCap.getUsage(userId),
    ]);
    // pushUsage: { sent, suppressed, cap } — 당일(KST) 관측치. settings.dailyPushCap 와 cap 동일.
    return { success: true, data: { ...settings, pushUsage } };
  }

  @Patch()
  @ApiOperation({ summary: '알림 설정 수정' })
  async update(@CurrentUser('id') userId: string, @Body() dto: UpdateNotificationSettingsDto) {
    const settings = await this.notificationSettingsService.update(userId, dto);
    return { success: true, data: settings };
  }
}
