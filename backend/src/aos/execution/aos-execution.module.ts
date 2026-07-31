import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../../prisma/prisma.module';
import { NotificationProducerModule } from '../../notifications/notification-producer.module';
import { AosAccountBootstrapService } from './services/aos-account-bootstrap.service';
import { AosOperationsLedgerService } from './services/aos-operations-ledger.service';
import { AosReconciliationService } from './services/aos-reconciliation.service';
import { CanonicalPaperLedgerService } from './services/canonical-paper-ledger.service';

@Module({
  imports: [ConfigModule, PrismaModule, NotificationProducerModule],
  providers: [
    AosAccountBootstrapService,
    AosOperationsLedgerService,
    AosReconciliationService,
    CanonicalPaperLedgerService,
  ],
  exports: [
    AosAccountBootstrapService,
    AosOperationsLedgerService,
    AosReconciliationService,
    CanonicalPaperLedgerService,
  ],
})
export class AosExecutionModule {}
