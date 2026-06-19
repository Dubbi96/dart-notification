// Engine5 — OrderRiskService: Risk veto + Audit Log 통합 (M11, DAR-18)
// AI 금지영역: Risk 판정·주문 승인은 순수 Rule. AI 개입 0.

import { Injectable } from '@nestjs/common';
import { checkRisk } from '../domain/risk-check.service';
import { KillSwitchManager } from '../domain/kill-switch';
import {
  RiskCheckInput,
  RiskCheckResult,
  RiskLimits,
  DEFAULT_RISK_LIMITS,
} from '../domain/risk-check.types';
import {
  IAuditLogRepository,
  CreateAuditLogInput,
} from '../repositories/audit-log.repository';

export interface OrderRiskRequest {
  idempotencyKey: string;
  corpCode: string;
  stockCode: string;
  side: 'BUY' | 'SELL';
  requestedShares: number;
  limitPrice: number;
  totalCapital: number;
  currentPositionValue: number;
  dailyPnl: number;
  weeklyPnl: number;
  openOrderCount: number;
  todayTradeCount: number;
  buyScore?: number;
}

export interface OrderRiskResponse {
  idempotencyKey: string;
  approved: boolean;
  result: RiskCheckResult;
  auditLogId: string;
}

@Injectable()
export class OrderRiskService {
  private readonly limits: RiskLimits;

  constructor(
    private readonly auditRepo: IAuditLogRepository,
    private readonly killSwitch: KillSwitchManager,
    limits?: Partial<RiskLimits>,
  ) {
    this.limits = { ...DEFAULT_RISK_LIMITS, ...limits };
  }

  /**
   * evaluateOrder — Risk 하드룰 검사 후 Audit Log 기록.
   * Risk veto: BuyScore 긍정이어도 Rule 위반 시 거부(veto 우선).
   */
  async evaluateOrder(req: OrderRiskRequest): Promise<OrderRiskResponse> {
    const input: RiskCheckInput = {
      corpCode: req.corpCode,
      stockCode: req.stockCode,
      side: req.side,
      requestedShares: req.requestedShares,
      limitPrice: req.limitPrice,
      totalCapital: req.totalCapital,
      currentPositionValue: req.currentPositionValue,
      dailyPnl: req.dailyPnl,
      weeklyPnl: req.weeklyPnl,
      openOrderCount: req.openOrderCount,
      todayTradeCount: req.todayTradeCount,
      killSwitchActive: this.killSwitch.isActive(),
      buyScore: req.buyScore,
    };

    const result = checkRisk(input, this.limits);

    // Audit Log 기록 — 승인/거부 모두 기록 (audit 누락 0)
    const auditInput: CreateAuditLogInput = result.approved
      ? {
          action: 'RISK_PASSED',
          actorKind: 'RISK_ENGINE',
          summary: `Risk 통과: ${req.side} ${req.stockCode} ${req.requestedShares}주`,
          meta: {
            idempotencyKey: req.idempotencyKey,
            buyScore: req.buyScore,
            capital: req.totalCapital,
          },
        }
      : {
          action: result.vetoed ? 'RISK_REJECTED' : 'RISK_REJECTED',
          actorKind: 'RISK_ENGINE',
          summary: result.vetoed
            ? `Risk veto: ${result.vetoReason}`
            : `Risk 거부: ${result.violations.map((v) => v.code).join(', ')}`,
          meta: {
            idempotencyKey: req.idempotencyKey,
            buyScore: req.buyScore,
            violations: result.violations,
            vetoed: result.vetoed,
            vetoReason: result.vetoReason,
          },
        };

    const auditLog = await this.auditRepo.save(auditInput);

    return {
      idempotencyKey: req.idempotencyKey,
      approved: result.approved,
      result,
      auditLogId: auditLog.id,
    };
  }

  /**
   * activateKillSwitch — 수동 Kill Switch 활성화
   */
  async activateKillSwitch(reason: string): Promise<void> {
    await this.killSwitch.activate(reason, 'USER');
    await this.auditRepo.save({
      action: 'KILL_SWITCH_SET',
      actorKind: 'USER',
      summary: `Kill Switch 수동 활성화: ${reason}`,
      meta: { reason },
    });
  }

  /**
   * deactivateKillSwitch — 수동 Kill Switch 해제
   */
  async deactivateKillSwitch(): Promise<void> {
    await this.killSwitch.deactivate();
    await this.auditRepo.save({
      action: 'KILL_SWITCH_RESET',
      actorKind: 'USER',
      summary: 'Kill Switch 수동 해제',
    });
  }

  isKillSwitchActive(): boolean {
    return this.killSwitch.isActive();
  }
}
