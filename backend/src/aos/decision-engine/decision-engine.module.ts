import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../../prisma/prisma.module';
import { BuySignalModule } from '../../engine3-quant-market/buy-signal/buy-signal.module';
import { DecisionParityQueryService } from './services/decision-parity-query.service';
import { EvaluateAndRecordDecisionService } from './services/evaluate-and-record-decision.service';
import { FreezeMarketRegimeSnapshotService } from './services/freeze-market-regime-snapshot.service';
import { LegacyDecisionDualWriteService } from './services/legacy-decision-dual-write.service';
import { RecordSignalDecisionService } from './services/record-signal-decision.service';

@Module({
  imports: [ConfigModule, PrismaModule, BuySignalModule],
  providers: [
    FreezeMarketRegimeSnapshotService,
    RecordSignalDecisionService,
    EvaluateAndRecordDecisionService,
    DecisionParityQueryService,
    LegacyDecisionDualWriteService,
  ],
  exports: [
    FreezeMarketRegimeSnapshotService,
    RecordSignalDecisionService,
    EvaluateAndRecordDecisionService,
    DecisionParityQueryService,
    LegacyDecisionDualWriteService,
  ],
})
export class DecisionEngineModule {}
