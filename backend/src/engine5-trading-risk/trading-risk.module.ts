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
// DAR-498(견고화 W2·P22): 주문 6관문 섀도 원장(OrderRequest/OrderExecution 병행 기록). 시스템
//   모의 트랙이 @Optional 로 주입받아 예약→체결/취소를 원장에 병행 기록(매매 무변경). AI 개입 0.
import { OrderShadowLedgerService } from './services/order-shadow-ledger.service';
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
// DAR-496(견고화 W2·P18): RiskGuard 공용 진입 게이트(일일손실·현금). 측정 트랙은 @Optional 로
//   주입받아 SHADOW 판정(기록만·차단 0), 듀얼모멘텀 코어 forward 만 ENFORCE. AI 개입 0.
import { RiskGuardService } from './services/risk-guard.service';
import { AosExecutionModule } from '../aos/execution/aos-execution.module';
import { CanonicalPaperLedgerService } from '../aos/execution/services/canonical-paper-ledger.service';

@Module({
  imports: [PrismaModule, NotificationProducerModule, AosExecutionModule],
  controllers: [PaperTradingController, AuditLogQueryController, AutoTradingStatusController],
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
      useFactory: (repo: PrismaPaperTradeRepository) => new PaperTradeService(repo),
      inject: [PrismaPaperTradeRepository],
    },
    {
      provide: OrderRiskService,
      useFactory: (auditRepo: PrismaAuditLogRepository, killSwitch: KillSwitchManager) =>
        new OrderRiskService(auditRepo, killSwitch),
      inject: [PrismaAuditLogRepository, KillSwitchManager],
    },
    // DAR-496(P18): 공용 진입 게이트 서비스 — PrismaService(RiskDecisionLog 영속) +
    //   @Optional NotificationProducerService(위반 OPS_ALERT). 순수 게이트 소비·AI 개입 0.
    RiskGuardService,
    // DAR-498(P22): 주문 6관문 섀도 원장 — PrismaService(원장 영속) + OrderRiskService(③한도 관문
    //   첫 실소비). ExecutionPort 는 기본 PaperExecutionAdapter(생성자 기본값·M12 KIS 치환점).
    {
      provide: OrderShadowLedgerService,
      useFactory: (
        prisma: PrismaService,
        orderRisk: OrderRiskService,
        canonical: CanonicalPaperLedgerService,
      ) => new OrderShadowLedgerService(prisma, orderRisk, undefined, canonical),
      inject: [PrismaService, OrderRiskService, CanonicalPaperLedgerService],
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
    // DAR-496(P18): 공용 진입 게이트를 각 모의 트랙 모듈(paper-sim·philosophy·strategy-fwd·
    //   dual-momentum)이 @Optional 로 주입받도록 export.
    RiskGuardService,
    // DAR-498(P22): 섀도 원장 서비스를 PaperSimulationModule(예약/체결/취소 훅)이 @Optional 로 주입.
    OrderShadowLedgerService,
  ],
})
export class TradingRiskModule {}
