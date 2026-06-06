// backend/src/engine1-disclosure/insider-holdings/insider-holdings.module.ts
import { Module } from '@nestjs/common';
import { DartApiModule } from '../dart-api/dart-api.module';
import { InsiderHoldingsService } from './insider-holdings.service';
import { InsiderHoldingsScheduler } from './insider-holdings.scheduler';

@Module({
  imports: [DartApiModule],
  providers: [InsiderHoldingsService, InsiderHoldingsScheduler],
  exports: [InsiderHoldingsService],
})
export class InsiderHoldingsModule {}
