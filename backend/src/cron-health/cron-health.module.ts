import { Global, Module } from '@nestjs/common';
import { CronHealthController } from './cron-health.controller';
import { DataFreshnessService } from './data-freshness.service';
import { DataFreshnessMonitorScheduler } from './data-freshness-monitor.scheduler';
import { CronRunRecorderService } from './cron-run-recorder.service';
import { NotificationProducerModule } from '../notifications/notification-producer.module';

// 크론 헬스 / 데이터 신선도 모니터 (DAR-110, 수집 안전망).
// @Global — CronRunRecorder 를 엔진 횡단 스케줄러(신호·모의운용·내부자·파싱재처리)에서
// 모듈 import 없이 주입받게 한다(기존 모듈 배선 최소 변경 = 회귀 위험 ↓).
// PrismaModule 은 전역이라 별도 import 불필요.
// DAR-476(P02): NotificationProducerModule — 신선도 정체 전환 시 OPS_ALERT 발송(감지점 배선).
@Global()
@Module({
  imports: [NotificationProducerModule],
  controllers: [CronHealthController],
  providers: [
    DataFreshnessService,
    DataFreshnessMonitorScheduler,
    CronRunRecorderService,
  ],
  exports: [DataFreshnessService, CronRunRecorderService],
})
export class CronHealthModule {}
