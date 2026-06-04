import { Module } from '@nestjs/common';
import { DartApiService } from './dart-api.service';

@Module({
  providers: [DartApiService],
  exports: [DartApiService],
})
export class DartApiModule {}
