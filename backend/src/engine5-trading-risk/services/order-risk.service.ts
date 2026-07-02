// Engine5 — OrderRiskService: Risk veto + Audit Log 통합 (M11, DAR-18)
// AI 금지영역: Risk 판정·주문 승인은 순수 Rule. AI 개입 0.

import { Injectable } from '@nestjs/common';
import { checkRisk } from '../domain/risk-check.service';
import { KillSwitchManager } from '../domain/kill-switch';
import {
  RiskCheckInput,
  RiskCheckResult,
  RiskLimits,
  RiskViolationCode,
  DEFAULT_RISK_LIMITS,
  DEFAULT_KILL_SWITCH_MODE,
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

// GAP-11: BUY 전용 하드룰 — 일/주 손실 한도는 "손실 확대(신규 진입)"를 막는 룰이다.
//   SELL(위험 축소·청산)까지 차단하면 한도 도달 시 위험을 줄이는 청산조차 막는
//   자기잠금이 되므로 side-gate 로 BUY 에만 적용한다. 순수 Rule — AI 개입 0.
const BUY_ONLY_VIOLATION_CODES: ReadonlyArray<RiskViolationCode> = [
  'DAILY_LOSS_LIMIT',
  'WEEKLY_LOSS_LIMIT',
];

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
   *
   * GAP-11 side-gate (순수 Rule — AI 개입 0):
   *  - Kill Switch REDUCE_ONLY(기본): 발동 중에도 SELL(청산·위험 축소)은 허용, BUY 만 차단.
   *    SELL 은 killSwitchActive=false 로 평가해 나머지 하드룰(중복주문·과매매)은 그대로 적용.
   *  - 일/주 손실 한도: BUY 전용 — SELL 결과에서 해당 위반을 걷어내고 approved 재계산.
   */
  async evaluateOrder(req: OrderRiskRequest): Promise<OrderRiskResponse> {
    // GAP-11: 킬스위치 발동 중 SELL 허용 여부(REDUCE_ONLY 기본 정책 — 스키마 변경 0, 코드 상수)
    const killSwitchActive = this.killSwitch.isActive();
    const killSwitchSellExempt =
      killSwitchActive &&
      DEFAULT_KILL_SWITCH_MODE === 'REDUCE_ONLY' &&
      req.side === 'SELL';

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
      killSwitchActive: killSwitchActive && !killSwitchSellExempt,
      buyScore: req.buyScore,
    };

    let result = checkRisk(input, this.limits);

    // GAP-11: 손실 한도(일/주)는 BUY 전용 — SELL 은 위험 축소이므로 해당 위반을 side-gate.
    if (req.side === 'SELL') {
      result = exemptBuyOnlyViolations(result, req.buyScore);
    }

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
            // GAP-11 감사 증적: 킬스위치 발동 중 REDUCE_ONLY 로 통과한 SELL 표시(투명성)
            ...(killSwitchSellExempt
              ? {
                  killSwitchMode: DEFAULT_KILL_SWITCH_MODE,
                  killSwitchSellAllowed: true,
                }
              : {}),
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

/**
 * GAP-11: SELL(위험 축소) 결과에서 BUY 전용 위반(일/주 손실 한도)을 제거하고
 * approved/vetoed 를 재계산한다. 잔여 위반(과매매·중복주문 등)은 그대로 유지 —
 * SELL 무차별 허용이 아니라 손실 한도만 side-gate 한다. 순수 함수 — AI 개입 0.
 */
function exemptBuyOnlyViolations(
  result: RiskCheckResult,
  buyScore?: number,
): RiskCheckResult {
  const violations = result.violations.filter(
    (v) => !BUY_ONLY_VIOLATION_CODES.includes(v.code),
  );
  if (violations.length === result.violations.length) {
    return result;
  }

  const approved = violations.length === 0;
  // checkRisk buildResult 와 동일한 veto 규칙 재계산(BuyScore 긍정 + 잔여 위반 존재 시에만 veto)
  const vetoed = !approved && buyScore !== undefined && buyScore >= 1;
  const vetoReason = vetoed
    ? `Risk veto: BuyScore=${buyScore}(긍정)이나 Rule 위반으로 거부 — ${violations.map((v) => v.code).join(', ')}`
    : undefined;

  return { approved, violations, vetoed, vetoReason };
}
