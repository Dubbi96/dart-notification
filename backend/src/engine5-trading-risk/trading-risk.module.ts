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
import { AutoTradingStatusService } from './services/auto-status.service';
import { AutoTradingStatusController } from './services/auto-status.controller';
import { PrismaPaperTradeRepository } from './repositories/prisma-paper-trade.repository';
import { PrismaAuditLogRepository } from './repositories/prisma-audit-log.repository';
import { PrismaKillSwitchStateRepository } from './repositories/prisma-kill-switch-state.repository';
import { KillSwitchManager } from './domain/kill-switch';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { PaperTradingController } from './paper-trading/paper-trading.controller';
import { PaperTradingService } from './paper-trading/paper-trading.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    PaperTradingController,
    AuditLogQueryController,
    AutoTradingStatusController,
  ],
  providers: [
    PaperTradingService,
    AuditLogQueryService,
    // DAR-361: 자동매매 실행상태 read-only 투명성(킬스위치·리스크게이트·최근 주문).
    // KillSwitchManager(영속 상태) + PrismaService(OrderRequest 조회)를 주입받아 집계만 한다.
    {
      provide: AutoTradingStatusService,
      useFactory: (prisma: PrismaService, killSwitch: KillSwitchManager) =>
        new AutoTradingStatusService(prisma, killSwitch),
      inject: [PrismaService, KillSwitchManager],
    },
    PrismaPaperTradeRepository,
    PrismaAuditLogRepository,
    PrismaKillSwitchStateRepository,
    // KillSwitchManager는 영속 레포를 주입해 부팅 시 DB 상태를 복원(DAR-350).
    // NestJS가 onModuleInit을 호출 → 재시작 후에도 발동 상태 유지(거짓 안전 교정).
    {
      provide: KillSwitchManager,
      useFactory: (killSwitchRepo: PrismaKillSwitchStateRepository) =>
        new KillSwitchManager(killSwitchRepo),
      inject: [PrismaKillSwitchStateRepository],
    },
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
