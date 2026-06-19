import { Injectable } from '@nestjs/common';
import { AiCostLevel, AiGateInput } from '../types/ai-analyst.types';

/**
 * AI 비용 게이트 — 어떤 공시가 어느 AI 레벨로 라우팅되는지 결정한다.
 * 이 판단은 **Rule 기반(AI 미사용)** 이다. cc-engine-architecture.md §6
 *
 * M3 범위: L0/L1/L2 분기까지 구현. buyScore/isHolding 기반 L3 분기는
 * M6(Buy Score)·M8(보유)에서 입력이 채워지면 활성화된다.
 */
@Injectable()
export class AiCostGateService {
  /**
   * 거래대금 하한 — 이 미만은 L0(AI 스킵).
   * ★전수분석(2026-06-19 사용자지시): 0 으로 완화 — 거래대금 무관 전 공시를 AI 분석 대상에 포함한다.
   *   (종전 1억원. L0≥70% 비용규율 회귀게이트는 전수분석 모드에서 의도적으로 완화됨 — engine2/CLAUDE.md 참조.)
   *   절대 비용은 AiCostLimitGuard 의 일일 한도($1/day)가 하드 백스톱으로 보호한다.
   */
  private static readonly THRESHOLD_MIN_TRADING_VALUE = 0;

  evaluateGate(input: AiGateInput): AiCostLevel {
    // 1. 무조건 L0(AI 미사용) 조건
    if (input.isManagementStock) return AiCostLevel.L0;
    if (!input.isTargetEventType) return AiCostLevel.L0;
    if (input.tradingValue < AiCostGateService.THRESHOLD_MIN_TRADING_VALUE) {
      return AiCostLevel.L0;
    }

    // 2. 추출 신뢰도 낮으면 보조(L1)만
    if (input.confidence < 0.5) return AiCostLevel.L1;

    // 3. M8(DAR-74) — 보유 종목 악재 → Thesis 재평가(L3).
    //    buyScore 유무와 무관하게 활성화한다: 보유 중 종목은 매수 후보 점수가
    //    없으므로(buyScore 미산출) buyScore 분기 안에 두면 영영 발동하지 않는다.
    //    비용 안전 경계: 보유 종목(isHolding) + 악재(polarity NEGATIVE)일 때만 L3.
    if (input.isHolding === true && input.polarity === 'NEGATIVE') {
      return AiCostLevel.L3;
    }

    // 4. M6 이후: Buy Score 기반 분기(매수 후보)
    if (typeof input.buyScore === 'number') {
      if (input.buyScore < 60) return AiCostLevel.L1;
      if (input.buyScore >= 80) return AiCostLevel.L3;
      return AiCostLevel.L2;
    }

    // 5. M3 기본값 — 대상 이벤트 + 충분한 신뢰도면 요약·Persona(L2)
    return AiCostLevel.L2;
  }
}
