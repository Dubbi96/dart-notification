import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QUEUE } from '../common/queues/queue.constants';
import { ExpoPushService } from './expo-push.service';
import { ExpoReceiptConsumer } from './expo-receipt.consumer';
import { DevicesModule } from '../devices/devices.module';

/**
 * 횡단 푸시 발송 모듈.
 *
 * DAR-182: receipt 검증을 durable BullMQ delayed job 으로 처리한다.
 * QUEUE.EXPO_RECEIPT 큐를 등록하고 ExpoReceiptConsumer 를 단독 소비자로 둔다.
 * 본 모듈은 여러 모듈이 import 하지만 NestJS 모듈 캐싱으로 단일 인스턴스이므로
 * consumer 워커는 1회만 등록된다(중복 발송 방지).
 */
@Module({
  imports: [DevicesModule, BullModule.registerQueue({ name: QUEUE.EXPO_RECEIPT })],
  providers: [ExpoPushService, ExpoReceiptConsumer],
  exports: [ExpoPushService],
})
export class ExpoPushModule {}
