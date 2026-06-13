import { Module } from '@nestjs/common';
import { CompaniesController } from './companies.controller';
import { CompaniesService } from './companies.service';
import { DartApiModule } from '../engine1-disclosure/dart-api/dart-api.module';
import { EventStudyModule } from '../engine3-quant-market/event-study/event-study.module';

@Module({
  imports: [DartApiModule, EventStudyModule],
  controllers: [CompaniesController],
  providers: [CompaniesService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
