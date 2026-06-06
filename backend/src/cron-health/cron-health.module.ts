import { Global, Module } from '@nestjs/common';
import { CronHealthController } from './cron-health.controller';
import { DataFreshnessService } from './data-freshness.service';
import { CronRunRecorderService } from './cron-run-recorder.service';

// 크론 헬스 / 데이터 신선도 모니터 (DAR-110, 수집 안전망).
// @Global — CronRunRecorder 를 엔진 횡단 스케줄러(신호·모의운용·내부자·파싱재처리)에서
// 모듈 import 없이 주입받게 한다(기존 모듈 배선 최소 변경 = 회귀 위험 ↓).
// PrismaModule 은 전역이라 별도 import 불필요.
@Global()
@Module({
  controllers: [CronHealthController],
  providers: [DataFreshnessService, CronRunRecorderService],
  exports: [DataFreshnessService, CronRunRecorderService],
})
export class CronHealthModule {}
