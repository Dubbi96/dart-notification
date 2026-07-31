import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../../prisma/prisma.module';
import { FeatureSnapshotDualWriteService } from './services/feature-snapshot-dual-write.service';
import { FreezeFeatureSnapshotService } from './services/freeze-feature-snapshot.service';

@Module({
  imports: [ConfigModule, PrismaModule],
  providers: [FreezeFeatureSnapshotService, FeatureSnapshotDualWriteService],
  exports: [FreezeFeatureSnapshotService, FeatureSnapshotDualWriteService],
})
export class FeatureEngineModule {}
