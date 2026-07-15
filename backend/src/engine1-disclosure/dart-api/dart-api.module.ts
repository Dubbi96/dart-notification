import { Module } from '@nestjs/common';
import { DartApiService } from './dart-api.service';
// W5 ④: 라이브 목록수집 예약분 소진 임계 OPS_ALERT — producer 전용 경량 모듈(consumer 미포함).
import { NotificationProducerModule } from '../../notifications/notification-producer.module';

@Module({
  imports: [NotificationProducerModule],
  providers: [DartApiService],
  exports: [DartApiService],
})
export class DartApiModule {}
