/**
 * TradingRiskModule — Engine 5 모의투자 + Risk 엔진 (M10-A DAR-16, M11 DAR-18)
 *
 * AI 금지영역: 체결·Risk 로직은 순수 Rule 기반. AI/LLM(engine2) 의존성 절대 금지.
 * 설계: docs/roadmap/phase-12-paper-trading.md
 */

import { Module } from '@nestjs/common';
import { PaperTradeService } from './services/paper-trade.service';
import { OrderRiskService } from './services/order-risk.service';
import { InMemoryPaperTradeRepository } from './repositories/in-memory-paper-trade.repository';
import { InMemoryAuditLogRepository } from './repositories/in-memory-audit-log.repository';
import { KillSwitchManager } from './domain/kill-switch';

@Module({
  providers: [
    InMemoryPaperTradeRepository,
    InMemoryAuditLogRepository,
    KillSwitchManager,
    {
      provide: 'IPaperTradeRepository',
      useClass: InMemoryPaperTradeRepository,
    },
    {
      provide: 'IAuditLogRepository',
      useClass: InMemoryAuditLogRepository,
    },
    {
      provide: PaperTradeService,
      useFactory: (repo: InMemoryPaperTradeRepository) => new PaperTradeService(repo),
      inject: [InMemoryPaperTradeRepository],
    },
    {
      provide: OrderRiskService,
      useFactory: (
        auditRepo: InMemoryAuditLogRepository,
        killSwitch: KillSwitchManager,
      ) => new OrderRiskService(auditRepo, killSwitch),
      inject: [InMemoryAuditLogRepository, KillSwitchManager],
    },
  ],
  exports: [PaperTradeService, OrderRiskService, InMemoryAuditLogRepository, KillSwitchManager],
})
export class TradingRiskModule {}
