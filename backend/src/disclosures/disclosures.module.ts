import { Module } from '@nestjs/common';
import { DisclosuresController } from './disclosures.controller';
import { DisclosuresService } from './disclosures.service';

@Module({
  controllers: [DisclosuresController],
  providers: [DisclosuresService],
  exports: [DisclosuresService],
})
export class DisclosuresModule {}
