import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { QueryNotificationDto } from './dto/query-notification.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: '알림 목록 조회' })
  async findAll(@CurrentUser('id') userId: string, @Query() query: QueryNotificationDto) {
    const result = await this.notificationsService.findAll(userId, query);
    return { success: true, data: result.items, meta: result.meta };
  }

  @Patch('read-all')
  @ApiOperation({ summary: '알림 모두 읽음 처리' })
  async markAllAsRead(@CurrentUser('id') userId: string) {
    const result = await this.notificationsService.markAllAsRead(userId);
    return { success: true, data: result };
  }

  @Patch(':id/read')
  @ApiOperation({ summary: '알림 읽음 처리' })
  async markAsRead(@CurrentUser('id') userId: string, @Param('id') id: string) {
    const notification = await this.notificationsService.markAsRead(userId, id);
    return { success: true, data: notification };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '알림 삭제' })
  async remove(@CurrentUser('id') userId: string, @Param('id') id: string) {
    await this.notificationsService.remove(userId, id);
  }
}
