import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { DartApiModule } from '../dart-api/dart-api.module';
import { ExpoPushModule } from '../expo-push/expo-push.module';

@Module({
  imports: [DartApiModule, ExpoPushModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
