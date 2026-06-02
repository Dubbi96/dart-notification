import { Module } from '@nestjs/common';
import { SavedDisclosuresController } from './saved-disclosures.controller';
import { SavedDisclosuresService } from './saved-disclosures.service';

@Module({
  controllers: [SavedDisclosuresController],
  providers: [SavedDisclosuresService],
  exports: [SavedDisclosuresService],
})
export class SavedDisclosuresModule {}
