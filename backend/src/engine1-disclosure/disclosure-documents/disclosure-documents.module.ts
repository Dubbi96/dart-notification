// backend/src/disclosure-documents/disclosure-documents.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { DartApiModule } from '../dart-api/dart-api.module';
import { DisclosureDocumentsService } from './disclosure-documents.service';
import { DisclosureDocumentsController } from './disclosure-documents.controller';
import { ParseRetryScheduler } from './parse-retry.scheduler';
import { LocalStorageService } from './storage/storage.service';
import { DartFiledFactService } from './facts/dart-filed-fact.service';
import { DisclosureEventsModule } from '../disclosure-events/disclosure-events.module';

@Module({
  imports: [
    // DartApiModule: DartApiService (downloadDocument, extractDocumentFromZip)
    // PrismaModule: @Global이므로 import 불필요
    DartApiModule,
    // M2 체이닝: forwardRef로 순환 참조 방지 (@Optional() 주입과 함께 사용)
    forwardRef(() => DisclosureEventsModule),
  ],
  controllers: [DisclosureDocumentsController],
  providers: [
    DisclosureDocumentsService,
    ParseRetryScheduler,
    LocalStorageService,
    DartFiledFactService,
  ],
  exports: [DisclosureDocumentsService, DartFiledFactService],
})
export class DisclosureDocumentsModule {}
