import { Module } from '@nestjs/common';
import { TechnicalIndicatorService } from './technical-indicator.service';

@Module({
  providers: [TechnicalIndicatorService],
  exports: [TechnicalIndicatorService],
})
export class IndicatorsModule {}
