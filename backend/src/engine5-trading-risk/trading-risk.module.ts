/**
 * TradingRiskModule — Engine 5 모의투자 + Risk 엔진 (M10-A DAR-16, M11 DAR-18/DAR-36)
 *
 * AI 금지영역: 체결·Risk 로직은 순수 Rule 기반. AI/LLM(engine2) 의존성 절대 금지.
 * 설계: docs/roadmap/phase-12-paper-trading.md
 *
 * DAR-36: 영속화 — 모의체결·감사로그 리포지토리를 InMemory → Prisma로 배선 교체.
 *   InMemory 구현체는 삭제하지 않고 테스트·폴백용으로 유지(스펙은 서비스를 직접 생성).
 */

import { Module } from '@nestjs/common';
import { PaperTradeService } from './services/paper-trade.service';
import { OrderRiskService } from './services/order-risk.service';
import { AuditLogQueryService } from './services/audit-log-query.service';
import { AuditLogQueryController } from './services/audit-log-query.controller';
import { PrismaPaperTradeRepository } from './repositories/prisma-paper-trade.repository';
import { PrismaAuditLogRepository } from './repositories/prisma-audit-log.repository';
import { KillSwitchManager } from './domain/kill-switch';
import { PrismaModule } from '../prisma/prisma.module';
import { PaperTradingController } from './paper-trading/paper-trading.controller';
import { PaperTradingService } from './paper-trading/paper-trading.service';

@Module({
  imports: [PrismaModule],
  controllers: [PaperTradingController, AuditLogQueryController],
  providers: [
    PaperTradingService,
    AuditLogQueryService,
    PrismaPaperTradeRepository,
    PrismaAuditLogRepository,
    KillSwitchManager,
    {
      provide: 'IPaperTradeRepository',
      useClass: PrismaPaperTradeRepository,
    },
    {
      provide: 'IAuditLogRepository',
      useClass: PrismaAuditLogRepository,
    },
    {
      provide: PaperTradeService,
      useFactory: (repo: PrismaPaperTradeRepository) =>
        new PaperTradeService(repo),
      inject: [PrismaPaperTradeRepository],
    },
    {
      provide: OrderRiskService,
      useFactory: (
        auditRepo: PrismaAuditLogRepository,
        killSwitch: KillSwitchManager,
      ) => new OrderRiskService(auditRepo, killSwitch),
      inject: [PrismaAuditLogRepository, KillSwitchManager],
    },
  ],
  exports: [
    PaperTradeService,
    OrderRiskService,
    PrismaAuditLogRepository,
    KillSwitchManager,
  ],
})
export class TradingRiskModule {}
