import { Module } from '@nestjs/common';
import { SchedulerController } from './scheduler.controller';
import { SchedulerService } from './scheduler.service';
import { DartApiModule } from '../dart-api/dart-api.module';
import { ExpoPushModule } from '../expo-push/expo-push.module';
import { DisclosureDocumentsModule } from '../disclosure-documents/disclosure-documents.module';

@Module({
  imports: [DartApiModule, ExpoPushModule, DisclosureDocumentsModule],
  controllers: [SchedulerController],
  providers: [SchedulerService],
})
export class SchedulerModule {}
