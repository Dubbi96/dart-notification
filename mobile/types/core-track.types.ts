// 듀얼모멘텀 코어 트랙(자산배분·월단위) 도메인 타입 — DAR-495 [견고화 W1·P17] (BE: DAR-494/495).
// GET /paper-trading/simulation/dual-momentum-forward/scorecard 응답과 1:1.
// ★ 전략 변형 4종(일봉 백테스트)·단타(분봉 forward)와 별개 축 — '자산배분(월단위)' 유형.
//   월말 1회 리밸런싱이라 표본 축적이 느려 LOW_SAMPLE 을 정직하게 표기한다(임계 6).

import type { EquityCurvePoint } from '@app-types/simulation.types';

/** 통일 매매 성적표(trade-scorecard SSOT 재사용) — 승률·평균손익·표본. */
export interface CoreTradeScorecard {
  /** 청산 완료 매매 수 = 표본 수. */
  closedCount: number;
  /** 수익 매매 수(pnl>0). */
  winCount: number;
  /** 손실 매매 수(pnl<0). */
  lossCount: number;
  /** 승률(0~1). 표본 0이면 null. */
  winRate: number | null;
  /** 평균 실현손익(원). */
  avgPnl: number;
  /** 평균 실현수익률(%). */
  avgPnlPct: number;
  /** 평균 보유일수. 산출 표본 0이면 null. */
  avgHoldDays: number | null;
  /** 누적 실현손익(원). */
  totalNetPnl: number;
  /** 누적 실현수익률(%). */
  cumulativeReturnPct: number;
  /** 표본 수(closedCount 동의어). */
  sampleSize: number;
  /** 표본 부족 여부(generic 임계 기준). */
  lowSample: boolean;
}

/** 리밸런싱(회전) 이력 한 행 — etfName 병기. */
export interface CoreRebalanceRow {
  /** 판정 거래일(YYYYMMDD, 매월 마지막 거래일). */
  decisionDate: string;
  /** 대상/보유 ETF 단축코드. */
  etfCode: string;
  /** ETF 표시 이름(없으면 null → 코드 대체). */
  etfName: string | null;
  /** PENDING | OPEN | CLOSED | CANCELLED. */
  status: string;
  /** 매수 체결가(미체결이면 null). */
  entryPrice: number | null;
  /** 매도 체결 거래일(YYYYMMDD, 미청산이면 null). */
  exitDate: string | null;
  /** 매도 체결가(미청산이면 null). */
  exitPrice: number | null;
  /** 순손익(원, 미청산이면 null). */
  netPnl: number | null;
  /** 순수익률(%, 미청산이면 null). */
  returnPct: number | null;
}

/** 코어 트랙 스코어카드 — GET /dual-momentum-forward/scorecard 와 1:1. */
export interface CoreTrackScorecard {
  /** 트랙 식별 태그(alloc:dual-momentum). */
  styleTag: string;
  /** ★유형 라벨 — '자산배분(월단위)'. 기존 트랙과 유형 구분(감사 C2). */
  trackTypeLabel: string;
  /** 리밸런싱 주기 — 월 1회. */
  rebalanceFrequency: 'MONTHLY';
  /** 한 줄 컨셉(룰북 §9.2). */
  tagline: string;
  initialCapital: number;
  /** 현재 보유 ETF 코드(현금이면 null). */
  holding: string | null;
  /** 현재 보유 ETF 표시 이름(현금이면 null). */
  holdingName: string | null;
  /** 대기 중(미체결) 예약 ETF 코드(있으면). */
  pendingTarget: string | null;
  /** 대기 중 예약 ETF 표시 이름(없으면 null). */
  pendingTargetName: string | null;
  /** 평가액(원). */
  equity: number;
  /** 누적 수익률(%) — 평가액 기준(미실현 포함). */
  cumulativeReturnPct: number;
  /** 통일 성적표. */
  scorecard: CoreTradeScorecard;
  /** 일별 자산곡선(오름차순; 0·1개도 정직하게). */
  equityCurve: EquityCurvePoint[];
  /** 마지막 스냅샷일(YYYYMMDD, 없으면 null). */
  latestSnapshotDate: string | null;
  /** 리밸런싱(회전) 이력. */
  rebalanceHistory: CoreRebalanceRow[];
  /** ★다음 월말 판정 예정일(YYYYMMDD) — 월 1회 리밸런싱 특성. */
  nextDecisionDate: string;
  /** 과신 방지 — 청산 표본 < 트랙 임계(월단위 느린 축적). */
  lowSample: boolean;
  /** 저표본 임계(청산 거래 수). */
  lowSampleThreshold: number;
}
