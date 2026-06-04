import { Module } from '@nestjs/common';
import { BuySignalService } from './buy-signal.service';

@Module({
  providers: [BuySignalService],
  exports: [BuySignalService],
})
export class BuySignalModule {}
