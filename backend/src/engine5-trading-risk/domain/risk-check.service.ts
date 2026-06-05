// Engine5 — RiskCheckService 하드룰 (M11, DAR-18)
// AI 금지영역: Risk 판정은 순수 Rule(수식/파라미터). AI 개입 0.
// 이 파일에서 AI/LLM/engine2 import는 절대 금지 (risk-guard 훅이 차단).

import {
  RiskCheckInput,
  RiskCheckResult,
  RiskViolation,
  RiskLimits,
  DEFAULT_RISK_LIMITS,
} from './risk-check.types';

/**
 * checkRisk — 순수 함수. 입력으로 포트폴리오 스냅샷을 받아 하드룰 위반 여부를 판정한다.
 *
 * Risk veto 원칙: BuyScore/AI가 긍정이어도 하드룰 위반이면 거부(veto 우선).
 * 위반 시 violations[] 배열에 사유가 담긴다.
 */
export function checkRisk(
  input: RiskCheckInput,
  limits: RiskLimits = DEFAULT_RISK_LIMITS,
): RiskCheckResult {
  const violations: RiskViolation[] = [];

  // 1. Kill Switch 확인 (최우선)
  if (input.killSwitchActive) {
    violations.push({
      code: 'KILL_SWITCH_ACTIVE',
      message: 'Kill Switch가 활성화되어 있습니다. 모든 주문이 차단됩니다.',
    });
    return buildResult(violations, input.buyScore);
  }

  // 매수 전용 규칙
  if (input.side === 'BUY') {
    // 2. 1회 매수 한도: 주문금액 / 총자산 ≤ singleBuyMaxPct
    const orderValue = input.requestedShares * input.limitPrice;
    const singleBuyPct = orderValue / input.totalCapital;
    if (singleBuyPct > limits.singleBuyMaxPct) {
      violations.push({
        code: 'SINGLE_BUY_LIMIT',
        message: `1회 매수 한도 초과: 주문비율 ${(singleBuyPct * 100).toFixed(2)}% > 허용 ${(limits.singleBuyMaxPct * 100).toFixed(0)}%`,
        details: {
          orderValue,
          totalCapital: input.totalCapital,
          actualPct: singleBuyPct,
          limitPct: limits.singleBuyMaxPct,
        },
      });
    }

    // 3. 단일 종목 한도: (현재 포지션 + 신규 주문) / 총자산 ≤ singlePositionMaxPct
    const newPositionValue = input.currentPositionValue + orderValue;
    const positionPct = newPositionValue / input.totalCapital;
    if (positionPct > limits.singlePositionMaxPct) {
      violations.push({
        code: 'SINGLE_POSITION_LIMIT',
        message: `단일 종목 한도 초과: 매수 후 비중 ${(positionPct * 100).toFixed(2)}% > 허용 ${(limits.singlePositionMaxPct * 100).toFixed(0)}%`,
        details: {
          currentPositionValue: input.currentPositionValue,
          orderValue,
          newPositionValue,
          totalCapital: input.totalCapital,
          actualPct: positionPct,
          limitPct: limits.singlePositionMaxPct,
        },
      });
    }
  }

  // 4. 일간 손실 한도: dailyPnl / totalCapital ≥ dailyLossMaxPct (음수)
  const dailyLossPct = input.dailyPnl / input.totalCapital;
  if (dailyLossPct < limits.dailyLossMaxPct) {
    violations.push({
      code: 'DAILY_LOSS_LIMIT',
      message: `일간 손실 한도 초과: ${(dailyLossPct * 100).toFixed(2)}% < 허용 ${(limits.dailyLossMaxPct * 100).toFixed(0)}%`,
      details: {
        dailyPnl: input.dailyPnl,
        totalCapital: input.totalCapital,
        actualPct: dailyLossPct,
        limitPct: limits.dailyLossMaxPct,
      },
    });
  }

  // 5. 주간 손실 한도: weeklyPnl / totalCapital ≥ weeklyLossMaxPct (음수)
  const weeklyLossPct = input.weeklyPnl / input.totalCapital;
  if (weeklyLossPct < limits.weeklyLossMaxPct) {
    violations.push({
      code: 'WEEKLY_LOSS_LIMIT',
      message: `주간 손실 한도 초과: ${(weeklyLossPct * 100).toFixed(2)}% < 허용 ${(limits.weeklyLossMaxPct * 100).toFixed(0)}%`,
      details: {
        weeklyPnl: input.weeklyPnl,
        totalCapital: input.totalCapital,
        actualPct: weeklyLossPct,
        limitPct: limits.weeklyLossMaxPct,
      },
    });
  }

  // 6. 중복 주문 방지: 미체결 주문 수 > maxOpenOrders
  if (input.openOrderCount >= limits.maxOpenOrders) {
    violations.push({
      code: 'DUPLICATE_ORDER',
      message: `미체결 주문 한도 초과: 현재 ${input.openOrderCount}건 ≥ 허용 ${limits.maxOpenOrders}건`,
      details: {
        openOrderCount: input.openOrderCount,
        maxOpenOrders: limits.maxOpenOrders,
      },
    });
  }

  // 7. 과매매 방지: 오늘 체결 횟수 ≥ maxDailyTrades
  if (input.todayTradeCount >= limits.maxDailyTrades) {
    violations.push({
      code: 'OVER_TRADING',
      message: `일간 최대 거래 횟수 초과: 오늘 ${input.todayTradeCount}회 ≥ 허용 ${limits.maxDailyTrades}회`,
      details: {
        todayTradeCount: input.todayTradeCount,
        maxDailyTrades: limits.maxDailyTrades,
      },
    });
  }

  return buildResult(violations, input.buyScore);
}

function buildResult(violations: RiskViolation[], buyScore?: number): RiskCheckResult {
  const approved = violations.length === 0;

  // Risk veto: AI(BuyScore)가 긍정(≥1)이어도 Rule 위반이면 거부
  const vetoed = !approved && buyScore !== undefined && buyScore >= 1;
  const vetoReason = vetoed
    ? `Risk veto: BuyScore=${buyScore}(긍정)이나 Rule 위반으로 거부 — ${violations.map((v) => v.code).join(', ')}`
    : undefined;

  return { approved, violations, vetoed, vetoReason };
}
