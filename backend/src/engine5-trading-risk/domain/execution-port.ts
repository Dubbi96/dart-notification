// Engine5 — ExecutionPort: 주문 전송·체결확인 추상화 (M11/M12 포트 씨앗, DAR-498 [견고화 W2·P22])
//
// AI 금지영역: 체결 로직은 순수 Rule(fill-simulator). AI/LLM(engine2) 의존성 절대 0.
//
// 배경(갭 A8·A9): 주문 6관문(멱등→잔고→한도→전송→체결확인→기록) 중 **전송·체결확인** 두 관문을
//   구현체 교체 가능한 포트로 추상화한다. 현재(M10/M11 SHADOW)는 실계좌가 없어 모의 체결
//   시뮬레이터에 위임하는 `PaperExecutionAdapter` 만 존재하고, M12 에서 실계좌 KIS 어댑터
//   (`KisExecutionAdapter`)로 **치환만** 하면 원장 기록 경로는 그대로 재사용된다.
//
//   ┌─ 6관문 ─────────────────────────────────────────────────────────────┐
//   │ ①멱등 ②잔고 ③한도  →  ④전송 ⑤체결확인(ExecutionPort)  →  ⑥기록(원장) │
//   └──────────────────────────────────────────────────────────────────────┘
//   ①~③ = 멱등키(tradingSignalId)·현금 가드(DAR-426)·Risk 하드룰(OrderRiskService).
//   ④~⑤ = 이 파일(전송·체결확인). ⑥ = OrderShadowLedgerService(OrderRequest/OrderExecution).
//
// ★M12 치환 지점(docs): KisExecutionAdapter 는 submitAndConfirm 에서 증권사 주문 API 를 호출하고
//   (전송) 체결 통보/폴링으로 실제 체결 수량·가격을 확인(체결확인)한 뒤 동일한 ExecutionOutcome
//   형태로 반환한다. 그때 원장(⑥)이 파생 상태가 아니라 SSOT 가 되고, 일일 대조 잡은 원장 vs
//   실계좌 대조(M12 소관)로 승격된다. 지금은 원장 vs PaperTrade(파생) 대조(DAR-498 §4).

import { DEFAULT_FILL_PARAMS, simulateFill } from './fill-simulator';
import { FillParams, TradeDirection, TradeStatus } from './paper-trade.types';

/** 전송할 주문(④전송 입력) — 결정 단계에서 확정된 주문 수량·기준가. */
export interface ExecutionOrder {
  corpCode: string;
  stockCode: string;
  side: TradeDirection;
  /** 결정 단계에서 확정된 주문 수량(현금 가드·한도 절삭 후 최종 수량). */
  orderedShares: number;
  /** 체결 기준가 — 모의: 당일 시가. 실계좌(M12): 주문 시점 호가/시장가 추정. */
  referencePrice: number;
  /** 당일 거래량(주) — 동적 슬리피지·부분체결 모델 입력(선택). */
  dayVolume?: number;
}

/** 체결확인 결과(⑤체결확인 출력) — 원장(OrderExecution) 기록의 입력. */
export interface ExecutionOutcome {
  filledShares: number;
  fillRate: number; // 0~1
  filledPrice: number; // 슬리피지 반영 체결가
  commission: number; // 수수료(KRW)
  tax: number; // 세금(KRW, 매도만)
  slippageCost: number; // 슬리피지 비용(KRW)
  status: TradeStatus;
}

/**
 * ExecutionPort — 전송·체결확인 관문의 구현체 교체 지점.
 *   현재 구현체: PaperExecutionAdapter(fill-simulator 위임).
 *   M12 구현체:  KisExecutionAdapter(증권사 API 전송 + 체결 통보 확인) — 미구현.
 */
export interface ExecutionPort {
  /** 구현체 식별자 — 원장 meta 에 남겨 어떤 경로로 체결됐는지 추적한다. */
  readonly adapterName: string;
  /**
   * 주문을 전송하고 체결을 확인한다.
   *   - PaperExecutionAdapter: 실전송 없이 fill-simulator 로 결정론적 체결을 산출(모의).
   *   - KisExecutionAdapter(M12): 증권사 API 전송 → 체결 통보/폴링으로 실제 체결 확인.
   */
  submitAndConfirm(
    order: ExecutionOrder,
    params?: FillParams,
  ): Promise<ExecutionOutcome>;
}

/**
 * PaperExecutionAdapter — 모의 체결 어댑터(현행 SHADOW). 실주문 전송 0.
 *
 * ★fill-simulator(simulateFill) 위임 — 시스템 모의 체결기(fillPendingEntries)가 쓰는 것과
 *   동일한 순수 함수·동일 입력(수량·시가·거래량·파라미터)이라, 원장(OrderExecution)에 기록되는
 *   체결 수량·가격은 PaperTrade 파생 상태와 결정론적으로 일치한다. 이 일치를 일일 대조 잡이
 *   독립 검증한다(두 계산이 어긋나면 OPS_ALERT).
 *
 * ★순수 위임 — side-effect·외부호출·AI 개입 0.
 */
export class PaperExecutionAdapter implements ExecutionPort {
  readonly adapterName = 'paper-sim';

  async submitAndConfirm(
    order: ExecutionOrder,
    params: FillParams = DEFAULT_FILL_PARAMS,
  ): Promise<ExecutionOutcome> {
    const fill = simulateFill(
      {
        direction: order.side,
        orderedShares: order.orderedShares,
        entryPrice: order.referencePrice,
        dayVolume: order.dayVolume,
      },
      params,
    );
    return {
      filledShares: fill.filledShares,
      fillRate: fill.fillRate,
      filledPrice: fill.filledPrice,
      commission: fill.commission,
      tax: fill.tax,
      slippageCost: fill.slippageCost,
      status: fill.status,
    };
  }
}
