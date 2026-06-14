import { Module } from '@nestjs/common';
import { SchedulerController } from './scheduler.controller';
import { SchedulerService } from './scheduler.service';
import { DartApiModule } from '../dart-api/dart-api.module';
import { ExpoPushModule } from '../../expo-push/expo-push.module';
import { DisclosureDocumentsModule } from '../disclosure-documents/disclosure-documents.module';
// DAR-259: 공시 푸시의 인박스-발송 멱등을 NotificationsService(createNotificationIfAbsent)로 묶는다.
import { NotificationsModule } from '../../notifications/notifications.module';

@Module({
  imports: [
    DartApiModule,
    ExpoPushModule,
    DisclosureDocumentsModule,
    NotificationsModule,
  ],
  controllers: [SchedulerController],
  providers: [SchedulerService],
})
export class SchedulerModule {}
