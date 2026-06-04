// 신호(매수/매도) 도메인 타입 계약 — 백엔드 Engine3(신호) API DTO 기준.
// ⚠️ 매수/매도 신호 엔드포인트는 아직 미존재(DAR-22). 이 계약은 화면/서비스가
// 의존하는 형태를 고정하고, 실제 응답이 생기면 그대로 연동된다.

export type SignalGrade = 'STRONG_BUY' | 'BUY' | 'WATCH' | 'BLOCKED';

export type ExitAction = 'HOLD' | 'WATCH' | 'REDUCE' | 'EXIT' | 'BLOCK_REBUY';

/** 진입 조건(필수/선택, 충족 여부) */
export interface EntryCondition {
  id: string;
  label: string;
  required: boolean;
  met: boolean;
}

/** 리스크 플래그 */
export interface RiskFlag {
  id: string;
  label: string;
  severity: 'high' | 'medium' | 'low';
}

/** Buy Score 구성 항목(상세 화면용, Phase B) */
export interface BuyScoreComponent {
  key: string;
  label: string;
  score: number;
  max: number;
}

/** 매수 신호 */
export interface TradingSignal {
  id: string;
  corpCode: string;
  corpName: string;
  ticker?: string;
  /** 공시 이벤트 종류 (예: 공급계약) */
  eventType?: string;
  grade: SignalGrade;
  /** 0~100 */
  buyScore: number;
  /** AI 매수 근거 요약 텍스트 */
  summary?: string;
  entryConditions: EntryCondition[];
  riskFlags: RiskFlag[];
  /** BLOCKED 신호의 차단 사유 */
  blockedReason?: string;
  scoreBreakdown?: BuyScoreComponent[];
  relatedDisclosureRcpNo?: string;
  /** ISO 8601 — 신호 만료 시각 */
  expiresAt?: string;
  /** ISO 8601 — 공시 발생/신호 생성 시각 */
  createdAt: string;
}

/** 매도 근거(아이콘 색상 매핑용 kind) */
export interface ExitReason {
  id: string;
  label: string;
  kind: 'loss' | 'thesis' | 'chart' | 'time';
}

/** 매도 신호 */
export interface ExitSignal {
  id: string;
  corpCode: string;
  corpName: string;
  ticker?: string;
  /** 0~100 */
  exitScore: number;
  action: ExitAction;
  reasons: ExitReason[];
  /** 권장 액션 텍스트 (예: 50% 분할 매도) */
  recommendedAction?: string;
  /** 현재 손익률(%) */
  pnlPercent?: number;
  /** 재매수 차단 여부 */
  blockRebuy?: boolean;
  createdAt: string;
}

/** 신호 피드 필터 */
export interface SignalFilters {
  personaType?: string;
  grade?: SignalGrade;
  entryReady?: boolean;
}

/** 이벤트 스터디 결과 — Prisma EventStudyResult 모델과 1:1 대응 */
export interface EventStudyResult {
  id: string;
  eventType: string;
  bucketKey: string;
  marketType: string;
  sampleCount: number;
  isSignificant: boolean;
  tStatistic?: number;
  pValue?: number;
  variance?: number;
  /** D+N 단순 수익률 평균 (%) */
  avgReturnD1: number;
  avgReturnD3: number;
  avgReturnD5: number;
  avgReturnD20: number;
  /** D+N 시장 대비 초과수익 (AR, %) */
  avgArD1: number;
  avgArD3: number;
  avgArD5: number;
  avgArD20: number;
  /** 분포 지표 */
  upProbD5: number;
  crashProbD5: number;
  avgMaxDrawdown: number;
  avgVolumeRatioD1: number;
  avgVolumeRatioD3: number;
  status: string;
  calculatedAt: string;
  dataFromDate: string;
  dataToDate: string;
}
