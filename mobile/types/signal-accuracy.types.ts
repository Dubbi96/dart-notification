// 신호 사후검증 백테스트 도메인 타입 계약 — DAR-73.
// GET /api/backtest/signal-accuracy 응답과 1:1.
// 백엔드 engine3-quant-market/backtest/signal-accuracy.ts (SignalAccuracyReport) 와 동기화.

/** 단일 지평(D+5 또는 D+20)의 실현 초과수익 정밀도 */
export interface HorizonAccuracy {
  /** 해당 지평에서 실현수익 산출 가능했던 표본 수 */
  sampleCount: number;
  /** 평균 초과수익(%). 표본 0이면 null */
  avgExcessReturn: number | null;
  /** 중앙값 초과수익(%). 표본 0이면 null */
  medianExcessReturn: number | null;
  /**
   * 강건(robust) 대표 초과수익(%) — 중앙값(median) 채택(백엔드 DAR-410).
   * 산술평균(avgExcessReturn)이 소수 극단치(폭등/폭락 표본)에 오염되는 것을 막는
   * 1차 표기 축(TRUST-02). 표본 0이면 null.
   */
  robustExcessReturn: number | null;
  /** 승률(초과수익>0 비율, 0~1). 표본 0이면 null */
  winRate: number | null;
  /** t-검정 p<0.05 (표본 충분 시만) */
  isSignificant: boolean;
  /** t-검정 p-값. 산출 불가 시 null */
  pValue: number | null;
}

/** 한 그룹(등급/구간/eventType)의 D+5·D+20 정밀도 */
export interface AccuracyBucket {
  /** 그룹 키 (등급 enum·구간 라벨·eventType enum) */
  key: string;
  /** 그룹 신호 수(지평 무관 전체 표본) */
  sampleCount: number;
  /** 표본 부족(과신 방지 배지) */
  lowSample: boolean;
  d5: HorizonAccuracy;
  d20: HorizonAccuracy;
}

/** 신호 사후검증 리포트 전체 */
export interface SignalAccuracyReport {
  overall: AccuracyBucket;
  byGrade: AccuracyBucket[];
  byScoreBand: AccuracyBucket[];
  byEventType: AccuracyBucket[];
  totalSignals: number;
  realizedD5: number;
  realizedD20: number;
}
