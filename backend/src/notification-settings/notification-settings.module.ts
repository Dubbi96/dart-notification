import { Module } from '@nestjs/common';
import { NotificationSettingsController } from './notification-settings.controller';
import { NotificationSettingsService } from './notification-settings.service';
// DAR-514: 설정 조회에 당일 푸시 발송/억제 관측치를 붙이기 위해 PushCapService 를 주입한다.
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [NotificationSettingsController],
  providers: [NotificationSettingsService],
  exports: [NotificationSettingsService],
})
export class NotificationSettingsModule {}
