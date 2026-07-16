import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE } from '../common/queues/queue.constants';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotifyConsumer } from './notify.consumer';
import { PushCapService } from './push-cap.service';
import { ExpoPushModule } from '../expo-push/expo-push.module';

/**
 * 통합 알림 인박스(DAR-84) + DAR-85 발송 consumer.
 *
 * NotifyConsumer 는 여기서만 1회 등록한다(AppModule 이 NotificationsModule 을 1회 import).
 * 엔진 모듈은 producer 전용 NotificationProducerModule 을 import 하므로 consumer 가
 * 중복 등록되지 않는다(워커 중복 방지).
 */
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE.NOTIFY }), ExpoPushModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotifyConsumer, PushCapService],
  // DAR-514: PushCapService 는 공시 발송 경로(SchedulerService)·설정 센터에서도 소비하므로 export.
  exports: [NotificationsService, PushCapService],
})
export class NotificationsModule {}
