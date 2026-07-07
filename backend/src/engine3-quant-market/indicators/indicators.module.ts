import { Module } from '@nestjs/common';
import { TechnicalIndicatorService } from './technical-indicator.service';
import { IndicatorBatchService } from './indicator-batch.service';
import { IndicatorBackfillService } from './indicator-backfill.service';
import { IndicatorBackfillController } from './indicator-backfill.controller';
import { IndicatorDailyScheduler } from './indicator-daily.scheduler';
import {
  InMemoryStockPriceRepository,
  InMemoryTechnicalIndicatorRepository,
} from './in-memory-indicator.repository';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [IndicatorBackfillController],
  providers: [
    TechnicalIndicatorService,
    IndicatorBatchService,
    IndicatorBackfillService,
    // 일일 기술지표 계산 크론(평일 18:50 + 21:10) — 수동 백필 전용이던 지표를 상시 적재로 전환.
    IndicatorDailyScheduler,
    InMemoryStockPriceRepository,
    InMemoryTechnicalIndicatorRepository,
  ],
  exports: [
    TechnicalIndicatorService,
    IndicatorBatchService,
    IndicatorBackfillService,
    InMemoryStockPriceRepository,
    InMemoryTechnicalIndicatorRepository,
  ],
})
export class IndicatorsModule {}
