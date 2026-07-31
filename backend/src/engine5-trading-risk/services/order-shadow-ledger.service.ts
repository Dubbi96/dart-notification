// Engine5 — OrderShadowLedgerService: 주문 6관문 섀도 원장 (M11 견고화 W2·P22, DAR-498)
//
// AI 금지영역: Risk 판정·체결은 순수 Rule(OrderRiskService·fill-simulator). AI/LLM(engine2) 0.
//
// 역할(시스템 모의 예약→체결/취소 흐름에 **병행 기록** — PaperTrade 경로 무변경):
//   1) recordReservation: 예약(PENDING) 확정 직후 — OrderRiskService.evaluateOrder(첫 실소비)로
//      판정을 남기고 OrderRequest 를 멱등 생성(idempotencyKey=tradingSignalId 결정적). SHADOW 이므로
//      veto 여도 기록만 하고 모의 체결은 기존 경로 그대로 진행한다.
//   2) recordFill: 체결(FILLED) 확정 직후 — ExecutionPort(전송·체결확인)로 결정론적 체결을 확인해
//      OrderExecution 을 생성하고 OrderRequest(status=EXECUTED)·paperTradeId·executionId 를 연결.
//   3) recordCancellation: 예약 취소(CANCELLED) — 미체결 OrderRequest 를 CANCELLED 로 종결.
//
// ★섀도 라이트 불변식(스펙 봉인): 이 서비스의 어떤 실패도 체결/매매 흐름에 영향 0.
//   모든 공개 메서드는 내부 try/catch 로 예외를 삼키고 절대 throw 하지 않는다(호출측은 결과 무시).
//   → 원장 기록이 깨져도 PaperTrade 파생 상태(SSOT)와 매매 행동은 무변경(M10 클록 보호).
//
// ★상태 의미론: OrderRequest.status 는 **판정 결과**(예약 시점 APPROVED/REJECTED/KILLED)를 남긴 뒤
//   체결 시 EXECUTED 로 전이한다. 즉 "REJECTED→EXECUTED" 이력은 M11 ENFORCE 라면 차단됐을 주문이
//   측정 트랙(SHADOW)에서 그대로 체결됐음을 뜻하는 관측 신호다(TradingAuditLog 로도 증적).
//   일일 대조 잡은 이 status 가 아니라 **체결 파생 상태(EXECUTED+OrderExecution) vs PaperTrade(FILLED)**
//   의 건수·수량·금액 정합을 본다 — status 전이와 무관하게 파생 정합이 유지된다.

import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ExecutionOrder, ExecutionPort, PaperExecutionAdapter } from '../domain/execution-port';
import { DEFAULT_FILL_PARAMS } from '../domain/fill-simulator';
import { OrderRiskService } from './order-risk.service';
import { CanonicalPaperLedgerService } from '../../aos/execution/services/canonical-paper-ledger.service';

/** 섀도 원장 OrderRequest 의 idempotencyKey 접두 — M11 실주문 OrderRequest 와 네임스페이스 분리. */
export const SHADOW_LEDGER_KEY_PREFIX = 'paper-sim-shadow:';

/** 멱등키 — 기존 멱등 체인(tradingSignalId) 기반 결정적 생성(한 신호 = 한 섀도 주문). */
export function shadowIdempotencyKey(tradingSignalId: string): string {
  return `${SHADOW_LEDGER_KEY_PREFIX}${tradingSignalId}`;
}

/** 예약(PENDING) 확정 직후 넘기는 진입 컨텍스트. */
export interface RecordReservationInput {
  portfolioId?: string;
  tradingSignalId: string;
  paperTradeId: string;
  corpCode: string;
  stockCode: string;
  /** 주문 수량(결정 단계 최종 수량). */
  orderedShares: number;
  /** 예약 기준가(사이징 근거·체결가 아님). */
  referencePrice: number;
  totalCapital: number;
  /** 당일 실현손익(음수=손실) — 일일손실 한도 판정 입력. */
  dailyRealizedPnl: number;
  weeklyRealizedPnl?: number;
  monthlyRealizedPnl?: number;
  drawdownPct?: number;
  /** 진입 직전 가용현금 — 잔고 관문 스냅샷. */
  availableCash: number;
  /** 미체결 주문 수(중복·과매매 판정 입력·best-effort). */
  openOrderCount: number;
  /** 당일 체결 수(과매매 판정 입력·best-effort). */
  todayTradeCount: number;
  openPositionCount?: number;
  validFrom?: Date;
  expiresAt?: Date;
  stopPrice?: number;
  takeProfitPrice?: number;
  maxHoldDays?: number;
  buyScore?: number;
  killSwitchActive?: boolean;
}

/** 체결(FILLED) 확정 직후 넘기는 체결 컨텍스트. */
export interface RecordFillInput {
  tradingSignalId: string;
  paperTradeId: string;
  corpCode: string;
  stockCode: string;
  /** 체결에 실제 쓴 최종 주문 수량(현금·한도 절삭 후). */
  orderedShares: number;
  /** 체결 기준가(당일 시가) — ExecutionPort 가 이 값으로 결정론적 체결을 확인. */
  referencePrice: number;
  dayVolume?: number;
  executedAt: Date;
  killSwitchActive?: boolean;
}

/** 예약 취소(CANCELLED) 컨텍스트. */
export interface RecordCancellationInput {
  tradingSignalId: string;
  paperTradeId: string;
  reason: string;
}

@Injectable()
export class OrderShadowLedgerService {
  private readonly logger = new Logger(OrderShadowLedgerService.name);

  constructor(
    private readonly prisma: PrismaService,
    // @Optional — OrderRiskService 미주입(단위 테스트)에서도 no-op 안전.
    @Optional() private readonly orderRisk?: OrderRiskService,
    // 전송·체결확인 포트(기본 모의 어댑터). M12 에서 KisExecutionAdapter 로 치환.
    @Optional() private readonly executionPort: ExecutionPort = new PaperExecutionAdapter(),
    // AOS A5 canonical ledger. 기본 OFF이며 기존 PaperTrade/OrderRequest 흐름과 격리한다.
    @Optional() private readonly canonical?: CanonicalPaperLedgerService,
  ) {}

  /**
   * recordReservation — 예약(PENDING) 확정 직후 1줄 호출. Risk 판정(evaluateOrder 첫 실소비) 후
   *   OrderRequest 를 멱등 생성/갱신한다. 실패는 삼켜 매매 흐름 보호(절대 throw 안 함).
   */
  async recordReservation(input: RecordReservationInput): Promise<void> {
    try {
      const idempotencyKey = shadowIdempotencyKey(input.tradingSignalId);
      const orderValue = input.orderedShares * input.referencePrice;
      const positionWeight = input.totalCapital > 0 ? orderValue / input.totalCapital : 0;

      // ③한도 관문 = OrderRiskService.evaluateOrder 첫 실소비(veto 여도 기록만·SHADOW).
      //   currentPositionValue=0: 후보는 corpCode 디듑돼 신규 진입(기보유 없음).
      //   weeklyPnl 은 이 경로에서 미추적 → dailyRealizedPnl 로 근사(측정 SHADOW·M11 이 전량 컨텍스트 공급).
      const decision = await this.orderRisk?.evaluateOrder({
        idempotencyKey,
        corpCode: input.corpCode,
        stockCode: input.stockCode,
        side: 'BUY',
        requestedShares: input.orderedShares,
        limitPrice: input.referencePrice,
        totalCapital: input.totalCapital,
        currentPositionValue: 0,
        dailyPnl: input.dailyRealizedPnl,
        weeklyPnl: input.dailyRealizedPnl,
        openOrderCount: input.openOrderCount,
        todayTradeCount: input.todayTradeCount,
        buyScore: input.buyScore,
      });

      const violationCodes = decision?.result.violations.map((v) => v.code) ?? [];
      const status = decision
        ? violationCodes.includes('KILL_SWITCH_ACTIVE')
          ? 'KILLED'
          : decision.approved
            ? 'APPROVED'
            : 'REJECTED'
        : 'PENDING'; // OrderRiskService 미주입 — 판정 없이 예약 기록만.
      const rejectionReason =
        decision && !decision.approved
          ? (decision.result.vetoReason ?? `Risk 위반: ${violationCodes.join(', ')}`)
          : null;

      const snapshot = {
        corpCode: input.corpCode,
        stockCode: input.stockCode,
        side: 'BUY' as const,
        requestedShares: input.orderedShares,
        limitPrice: new Prisma.Decimal(input.referencePrice),
        status: status as Prisma.OrderRequestCreateInput['status'],
        rejectionReason,
        capitalSnapshot: new Prisma.Decimal(input.totalCapital),
        dailyLossSnapshot: new Prisma.Decimal(input.dailyRealizedPnl),
        weeklyLossSnapshot: new Prisma.Decimal(input.dailyRealizedPnl),
        // Decimal(5,4) — 비중 분율. 이론상 <1 이나 오버플로 방지로 상한 클램프.
        positionWeightSnap: new Prisma.Decimal(Math.min(9.9999, positionWeight)),
        buyScoreSnapshot: input.buyScore ?? null,
        paperTradeId: input.paperTradeId,
      };

      // 멱등: 같은 신호 재기록(크론 재실행·리셋 후 재예약)은 링크·스냅샷만 갱신.
      await this.prisma.orderRequest.upsert({
        where: { idempotencyKey },
        create: { idempotencyKey, ...snapshot },
        update: {
          status: snapshot.status,
          rejectionReason: snapshot.rejectionReason,
          requestedShares: snapshot.requestedShares,
          limitPrice: snapshot.limitPrice,
          capitalSnapshot: snapshot.capitalSnapshot,
          dailyLossSnapshot: snapshot.dailyLossSnapshot,
          weeklyLossSnapshot: snapshot.weeklyLossSnapshot,
          positionWeightSnap: snapshot.positionWeightSnap,
          buyScoreSnapshot: snapshot.buyScoreSnapshot,
          paperTradeId: snapshot.paperTradeId,
        },
      });
      if (input.portfolioId && input.validFrom && input.expiresAt) {
        await this.canonical?.tryRecordReservation({
          portfolioId: input.portfolioId,
          tradingSignalId: input.tradingSignalId,
          paperTradeId: input.paperTradeId,
          corpCode: input.corpCode,
          stockCode: input.stockCode,
          orderedShares: input.orderedShares,
          referencePrice: input.referencePrice,
          totalCapital: input.totalCapital,
          availableCash: input.availableCash,
          dailyRealizedPnl: input.dailyRealizedPnl,
          weeklyRealizedPnl: input.weeklyRealizedPnl ?? input.dailyRealizedPnl,
          monthlyRealizedPnl: input.monthlyRealizedPnl ?? input.dailyRealizedPnl,
          drawdownPct: input.drawdownPct ?? 0,
          openOrderCount: input.openOrderCount,
          todayTradeCount: input.todayTradeCount,
          openPositionCount: input.openPositionCount ?? 0,
          killSwitchActive: input.killSwitchActive ?? false,
          validFrom: input.validFrom,
          expiresAt: input.expiresAt,
          stopPrice: input.stopPrice,
          takeProfitPrice: input.takeProfitPrice,
          maxHoldDays: input.maxHoldDays,
        });
      }
    } catch (e) {
      this.logger.error(
        `[ShadowLedger] recordReservation 실패(무시) signal=${input.tradingSignalId}: ${(e as Error).message}`,
      );
    }
  }

  /**
   * recordFill — 체결(FILLED) 확정 직후 1줄 호출. ExecutionPort(전송·체결확인)로 결정론적 체결을
   *   확인해 OrderExecution 을 생성하고 OrderRequest(EXECUTED)·연결 FK 를 잇는다. 실패는 삼킴.
   */
  async recordFill(input: RecordFillInput): Promise<void> {
    try {
      const idempotencyKey = shadowIdempotencyKey(input.tradingSignalId);
      const request = await this.prisma.orderRequest.findUnique({
        where: { idempotencyKey },
        select: { id: true, status: true },
      });
      // 예약 기록이 없으면(예약 훅 실패 등) 원장 정합이 깨진 것 — 일일 대조 잡이 orphan 으로 표면화.
      if (!request) {
        this.logger.warn(
          `[ShadowLedger] recordFill: OrderRequest 없음(orphan) signal=${input.tradingSignalId}`,
        );
        return;
      }
      if (request.status === 'EXECUTED') return; // 멱등 — 이미 체결 기록됨.

      const order: ExecutionOrder = {
        corpCode: input.corpCode,
        stockCode: input.stockCode,
        side: 'BUY',
        orderedShares: input.orderedShares,
        referencePrice: input.referencePrice,
        dayVolume: input.dayVolume,
      };
      // ④전송 ⑤체결확인 — 포트 위임(모의: fill-simulator 결정론적 체결).
      const outcome = await this.executionPort.submitAndConfirm(order, DEFAULT_FILL_PARAMS);
      if (outcome.filledShares <= 0) return; // 미체결 — OrderExecution 미생성(체결기도 스킵).

      const gross = outcome.filledPrice * outcome.filledShares;
      const netAmount = gross - outcome.commission - outcome.tax;

      // ⑥기록 — OrderExecution 생성 후 OrderRequest 를 EXECUTED 로 전이하며 연결(FK).
      const execution = await this.prisma.orderExecution.create({
        data: {
          corpCode: input.corpCode,
          stockCode: input.stockCode,
          side: 'BUY',
          executedShares: outcome.filledShares,
          executedPrice: new Prisma.Decimal(outcome.filledPrice),
          commission: new Prisma.Decimal(outcome.commission),
          tax: new Prisma.Decimal(outcome.tax),
          slippage: new Prisma.Decimal(outcome.slippageCost),
          netAmount: new Prisma.Decimal(netAmount),
          executedAt: input.executedAt,
        },
        select: { id: true },
      });

      await this.prisma.orderRequest.update({
        where: { id: request.id },
        data: {
          status: 'EXECUTED',
          executionId: execution.id,
          paperTradeId: input.paperTradeId,
        },
      });

      // TradingAuditLog INSERT-ONLY(점5) — 체결 감사 증적. 실패 시 조용히 스킵(격리).
      await this.insertAudit({
        action: 'ORDER_EXECUTED',
        actorKind: 'SYSTEM',
        summary: `섀도 원장 체결: BUY ${input.stockCode} ${outcome.filledShares}주 @${outcome.filledPrice}`,
        orderRequestId: request.id,
        executionId: execution.id,
        meta: {
          idempotencyKey,
          adapter: this.executionPort.adapterName,
          paperTradeId: input.paperTradeId,
          gross,
        },
      });
      await this.canonical?.tryRecordFill({
        paperTradeId: input.paperTradeId,
        filledShares: outcome.filledShares,
        filledPrice: outcome.filledPrice,
        commission: outcome.commission,
        tax: outcome.tax,
        slippage: outcome.slippageCost,
        filledAt: input.executedAt,
        killSwitchActive: input.killSwitchActive ?? false,
      });
    } catch (e) {
      this.logger.error(
        `[ShadowLedger] recordFill 실패(무시) signal=${input.tradingSignalId}: ${(e as Error).message}`,
      );
    }
  }

  /**
   * recordCancellation — 예약 취소(CANCELLED). 미체결 OrderRequest 만 종결(체결분은 무변경). 실패는 삼킴.
   */
  async recordCancellation(input: RecordCancellationInput): Promise<void> {
    try {
      const idempotencyKey = shadowIdempotencyKey(input.tradingSignalId);
      const request = await this.prisma.orderRequest.findUnique({
        where: { idempotencyKey },
        select: { id: true, status: true },
      });
      if (!request) return; // 예약 기록 없음 — 취소할 원장 없음(정상: 예약 훅이 no-op이었던 경우).
      if (request.status === 'EXECUTED' || request.status === 'CANCELLED') return; // 멱등.

      await this.prisma.orderRequest.update({
        where: { id: request.id },
        data: { status: 'CANCELLED', rejectionReason: input.reason },
      });
      await this.insertAudit({
        action: 'ORDER_CANCELLED',
        actorKind: 'SYSTEM',
        summary: `섀도 원장 예약 취소: ${input.reason}`,
        orderRequestId: request.id,
        meta: { idempotencyKey, paperTradeId: input.paperTradeId, reason: input.reason },
      });
      await this.canonical?.tryRecordCancellation(input.paperTradeId);
    } catch (e) {
      this.logger.error(
        `[ShadowLedger] recordCancellation 실패(무시) signal=${input.tradingSignalId}: ${(e as Error).message}`,
      );
    }
  }

  /** TradingAuditLog INSERT — INSERT-ONLY 규약(점5). 격리 실패 삼킴. */
  private async insertAudit(data: {
    action: Prisma.TradingAuditLogCreateInput['action'];
    actorKind: string;
    summary: string;
    orderRequestId?: string;
    executionId?: string;
    meta?: Prisma.InputJsonValue;
  }): Promise<void> {
    try {
      await this.prisma.tradingAuditLog.create({
        data: {
          action: data.action,
          actorKind: data.actorKind,
          summary: data.summary,
          orderRequestId: data.orderRequestId ?? null,
          executionId: data.executionId ?? null,
          meta: data.meta,
        },
      });
    } catch (e) {
      this.logger.error(`[ShadowLedger] TradingAuditLog 기록 실패(무시): ${(e as Error).message}`);
    }
  }
}
