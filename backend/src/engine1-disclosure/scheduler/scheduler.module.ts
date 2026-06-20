import { Module } from '@nestjs/common';
import { SchedulerController } from './scheduler.controller';
import { SchedulerService } from './scheduler.service';
import { DartApiModule } from '../dart-api/dart-api.module';
import { ExpoPushModule } from '../../expo-push/expo-push.module';
import { DisclosureDocumentsModule } from '../disclosure-documents/disclosure-documents.module';
// DAR-259: 공시 푸시의 인박스-발송 멱등을 NotificationsService(createNotificationIfAbsent)로 묶는다.
import { NotificationsModule } from '../../notifications/notifications.module';
// DAR-396: 과거 공시 메타데이터 연속 확장 백필(드레이너 + 매시간 cron).
import { ContinuousBackfillDrainService } from './continuous-backfill-drain.service';
import { ContinuousBackfillScheduler } from './continuous-backfill.scheduler';

@Module({
  imports: [
    DartApiModule,
    ExpoPushModule,
    DisclosureDocumentsModule,
    NotificationsModule,
  ],
  controllers: [SchedulerController],
  providers: [
    SchedulerService,
    // DAR-396: 연속 과거 확장 백필 드레이너 + 스케줄러.
    ContinuousBackfillDrainService,
    ContinuousBackfillScheduler,
  ],
  exports: [ContinuousBackfillDrainService],
})
export class SchedulerModule {}
