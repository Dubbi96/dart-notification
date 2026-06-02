// backend/src/disclosure-documents/disclosure-documents.module.ts

import { Module } from '@nestjs/common';
import { DartApiModule } from '../dart-api/dart-api.module';
import { DisclosureDocumentsService } from './disclosure-documents.service';
import { DisclosureDocumentsController } from './disclosure-documents.controller';
import { ParseRetryScheduler } from './parse-retry.scheduler';
import { LocalStorageService } from './storage/storage.service';

@Module({
  imports: [
    // DartApiModule: DartApiService (downloadDocument, extractDocumentFromZip)
    // PrismaModule: @Global이므로 import 불필요
    DartApiModule,
  ],
  controllers: [DisclosureDocumentsController],
  providers: [
    DisclosureDocumentsService,
    ParseRetryScheduler,
    LocalStorageService,
  ],
  exports: [DisclosureDocumentsService],
})
export class DisclosureDocumentsModule {}
