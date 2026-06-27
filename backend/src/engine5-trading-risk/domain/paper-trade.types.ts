// Engine5 — Paper Trade domain types (M10-A, DAR-16)
// AI 금지영역: 체결·Risk 로직 순수 Rule. AI 개입 0.

export type TradeDirection = 'BUY' | 'SELL';
export type TradeStatus = 'PENDING' | 'FILLED' | 'PARTIAL' | 'CANCELLED' | 'REJECTED';

export interface FillParams {
  commissionRate: number;   // 수수료율 (양수, 예: 0.00015)
  sellTaxRate: number;      // 매도세율 (예: 0.0018)
  slippagePct: number;      // 기본(base) 슬리피지 % (예: 0.0005)
  partialFillThreshold: number; // 부분체결 임계 유동성비율 (0~1)
  // F8 Phase2(2026-06-27): 거래량 기반 동적 슬리피지·부분체결(매수 전용). 선택 — 미지정 시 코드 기본값.
  //   maxParticipation: 일거래량 대비 전량체결 허용 참여율 상한(초과분만 부분체결). 기본 0.10(10% ADV).
  //   impactCoeff(α): 제곱근 시장충격 계수. 슬리피지 = base + α·√(참여율). 기본 0.015.
  //   ★캘리브레이션 근거(2026-06-27 실데이터): 모의 주문 참여율 p90=0.03%·max=0.07% → 10% 상한은
  //     ~140배 헤드룸이라 현 규모는 전량체결·base 슬리피지(거동 불변), 모델은 대규모 주문에서만 발효.
  maxParticipation?: number;
  impactCoeff?: number;
}

export interface FillRequest {
  direction: TradeDirection;
  orderedShares: number;
  entryPrice: number;       // 다음거래일 시가
  liquidityRatio?: number;  // 종목 유동성비율 (명시 시 우선; 없으면 dayVolume 기반 산정/1.0)
  dayVolume?: number;       // F8 Phase2: 당일 거래량(주) — 참여율 기반 동적 슬리피지/부분체결(매수)용
}

export interface FillResult {
  filledShares: number;
  fillRate: number;         // 0~1
  filledPrice: number;      // 슬리피지 반영 체결가
  commission: number;       // 수수료 (KRW)
  tax: number;              // 세금 (KRW, 매도만)
  slippageCost: number;     // 슬리피지 비용 (KRW)
  status: TradeStatus;
}

export interface PaperHolding {
  corpCode: string;
  stockCode: string;
  shares: number;
  avgEntryPrice: number;    // 가중평균 진입가
  currentPrice: number;
  marketValue: number;      // 평가금액
  unrealizedPnl: number;    // 미실현 손익
  unrealizedPnlPct: number; // 미실현 손익률
  weight: number;           // 포트폴리오 내 비중 (0~1)
}

export interface PaperPortfolioState {
  cash: number;             // 보유 현금 (KRW)
  totalMarketValue: number; // 주식 평가총액
  totalValue: number;       // 총 자산 (현금 + 주식)
  totalUnrealizedPnl: number;
  totalRealizedPnl: number;
  holdings: PaperHolding[];
}

export interface CostMetricsInput {
  totalDisclosures: number;
  totalSignals: number;
  totalTrades: number;
  totalAiCostKrw: number;   // 총 AI 비용 (KRW 환산)
  totalNetPnl: number;      // 총 순손익 (KRW)
}

export interface CostMetrics {
  costPerDisclosure: number;  // AI비용 / 공시수
  costPerSignal: number;      // AI비용 / 신호수
  costPerTrade: number;       // AI비용 / 거래수
  aiCostToNetPnlRatio: number | null; // AI비용 / 순익 비율 (순익 0 이하면 측정 불가 → null)
}
