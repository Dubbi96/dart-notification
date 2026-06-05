import { Module } from '@nestjs/common';
import { TechnicalIndicatorService } from './technical-indicator.service';
import { IndicatorBatchService } from './indicator-batch.service';
import {
  InMemoryStockPriceRepository,
  InMemoryTechnicalIndicatorRepository,
} from './in-memory-indicator.repository';

@Module({
  providers: [
    TechnicalIndicatorService,
    IndicatorBatchService,
    InMemoryStockPriceRepository,
    InMemoryTechnicalIndicatorRepository,
  ],
  exports: [
    TechnicalIndicatorService,
    IndicatorBatchService,
    InMemoryStockPriceRepository,
    InMemoryTechnicalIndicatorRepository,
  ],
})
export class IndicatorsModule {}
