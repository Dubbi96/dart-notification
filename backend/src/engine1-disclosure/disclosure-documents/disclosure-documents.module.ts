// backend/src/disclosure-documents/disclosure-documents.module.ts

import { Module, forwardRef } from '@nestjs/common';
import { DartApiModule } from '../dart-api/dart-api.module';
import { DisclosureDocumentsService } from './disclosure-documents.service';
import { DisclosureDocumentsController } from './disclosure-documents.controller';
import { ParseRetryScheduler } from './parse-retry.scheduler';
import { DartFiledFactService } from './facts/dart-filed-fact.service';
import { DartFiledFactController } from './facts/dart-filed-fact.controller';
import { DisclosureEventsModule } from '../disclosure-events/disclosure-events.module';

@Module({
  imports: [
    // DartApiModule: DartApiService (downloadDocument, extractDocumentFromZip)
    // PrismaModule: @Global이므로 import 불필요
    DartApiModule,
    // M2 체이닝: forwardRef로 순환 참조 방지 (@Optional() 주입과 함께 사용)
    forwardRef(() => DisclosureEventsModule),
  ],
  controllers: [DisclosureDocumentsController, DartFiledFactController],
  providers: [
    // DAR-401: 원본 HTML 저장이 S3/객체 스토리지(StorageModule @Global)로 고정됨에 따라
    //   LocalStorageService(로컬 디스크 저장)는 더 이상 provider 로 등록하지 않는다.
    DisclosureDocumentsService,
    ParseRetryScheduler,
    DartFiledFactService,
  ],
  exports: [DisclosureDocumentsService, DartFiledFactService],
})
export class DisclosureDocumentsModule {}
