// backend/src/engine1-disclosure/insider-holdings/insider-holdings.module.ts
import { Module } from '@nestjs/common';
import { DartApiModule } from '../dart-api/dart-api.module';
import { InsiderHoldingsService } from './insider-holdings.service';
import { InsiderHoldingsScheduler } from './insider-holdings.scheduler';
import { InsiderHoldingsController } from './insider-holdings.controller';

@Module({
  imports: [DartApiModule],
  controllers: [InsiderHoldingsController],
  providers: [InsiderHoldingsService, InsiderHoldingsScheduler],
  exports: [InsiderHoldingsService],
})
export class InsiderHoldingsModule {}
