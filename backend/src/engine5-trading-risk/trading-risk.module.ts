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
import { NotificationProducerModule } from '../notifications/notification-producer.module';
import { NotificationProducerService } from '../notifications/notification-producer.service';

@Module({
  imports: [PrismaModule, NotificationProducerModule],
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
    // DAR-476(P02): 발동 통지 포트를 producer.enqueueRiskAlert 로 어댑트해 주입 —
    //   발동(수동/자동) 즉시 RISK_ALERT. 룰/차단 로직 무변경(통지는 fire-and-forget·graceful).
    {
      provide: KillSwitchManager,
      useFactory: (
        killSwitchRepo: PrismaKillSwitchStateRepository,
        producer: NotificationProducerService,
      ) =>
        new KillSwitchManager(killSwitchRepo, {
          onActivated: ({ reason, triggeredBy, activatedAt }) => {
            const trigger = triggeredBy === 'USER' ? '수동' : '자동';
            void producer.enqueueRiskAlert(
              'CRITICAL',
              'kill-switch',
              `킬스위치 발동(${trigger}) — 신규 주문이 전면 차단됩니다. 사유: ${reason}`,
              {
                // 자연키에 활성화 시각(분 단위)을 포함 → 동일 사유 재발동은 구분, 중복 폭주는 억제.
                dedupeKey: `kill-switch:activate:${activatedAt.toISOString().slice(0, 16)}`,
                deepLink: '/portfolio',
                data: { reason, triggeredBy, activatedAt: activatedAt.toISOString() },
              },
            );
          },
        }),
      inject: [PrismaKillSwitchStateRepository, NotificationProducerService],
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
    // DAR-487(견고화 W3·P26): 장 시작 전 프리플라이트가 킬스위치·리스크 게이트 상태를 read-only 로
    //   재사용(OpsModule 주입). 실행 액션 없는 조회 서비스(executionEnabled 항상 false).
    AutoTradingStatusService,
  ],
})
export class TradingRiskModule {}
