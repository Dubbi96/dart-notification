import { Module } from '@nestjs/common';
import { TechnicalIndicatorService } from './technical-indicator.service';
import { IndicatorBatchService } from './indicator-batch.service';
import { IndicatorBackfillService } from './indicator-backfill.service';
import { IndicatorBackfillController } from './indicator-backfill.controller';
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
