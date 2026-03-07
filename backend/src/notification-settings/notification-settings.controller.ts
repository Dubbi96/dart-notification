import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { NotificationSettingsService } from './notification-settings.service';
import { UpdateNotificationSettingsDto } from './dto/update-notification-settings.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Notification Settings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notification-settings')
export class NotificationSettingsController {
  constructor(private readonly notificationSettingsService: NotificationSettingsService) {}

  @Get()
  @ApiOperation({ summary: '알림 설정 조회' })
  async findOne(@CurrentUser('id') userId: string) {
    const settings = await this.notificationSettingsService.findByUserId(userId);
    return { success: true, data: settings };
  }

  @Patch()
  @ApiOperation({ summary: '알림 설정 수정' })
  async update(@CurrentUser('id') userId: string, @Body() dto: UpdateNotificationSettingsDto) {
    const settings = await this.notificationSettingsService.update(userId, dto);
    return { success: true, data: settings };
  }
}
