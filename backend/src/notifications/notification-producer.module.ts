import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE } from '../common/queues/queue.constants';
import { NotificationProducerService } from './notification-producer.service';

/**
 * DAR-85 — 알림 producer 전용 경량 모듈.
 *
 * 엔진 모듈(3/4/5)이 import 한다. NOTIFY 큐만 register 하고 producer 만 export 하므로
 * consumer(NotifyConsumer)·NotificationsService 등 무거운 의존을 끌어오지 않는다
 * (엔진→알림 순환 의존 방지). consumer 는 NotificationsModule 에만 1회 등록된다.
 */
@Module({
  imports: [BullModule.registerQueue({ name: QUEUE.NOTIFY })],
  providers: [NotificationProducerService],
  exports: [NotificationProducerService],
})
export class NotificationProducerModule {}
