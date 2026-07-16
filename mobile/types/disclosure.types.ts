export interface Disclosure {
  rcpNo: string;
  corpCode: string;
  corpName: string;
  /** 종목코드 6자리(상장사). 비상장·미연동 공시는 null (DAR-188, 상세 응답에서만 평탄화 제공). */
  stockCode?: string | null;
  reportName: string;
  rcpDt: string;
  flrName: string;
  rmk: string;
  disclosureType: string;
  createdAt: string;
  dartUrl?: string;
}

/**
 * '오늘의 공시' 집계 (GET /disclosures/today-count, DAR-420).
 * '오늘' = 최신 가용 공시일(max rcpDt의 날짜). 전체 누적이 아님.
 */
export interface TodayDisclosureCount {
  /** 최신 가용 공시일 YYYYMMDD (데이터 없으면 null). 라벨 보조표기용. */
  date: string | null;
  /** 그 날짜의 공시 건수. */
  count: number;
}

/** 공시 AI 이벤트 분석 결과 (GET /disclosure-events/:rcpNo 실연동) */
export interface DisclosureEvent {
  id: string;
  rcpNo: string;
  corpCode: string;
  eventType: string;
  /** extractedData: 핵심수치 JSON — 구조는 이벤트 종류별 상이 */
  extractedData: Record<string, unknown>;
  polarity: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' | string;
  confidence: number;
  isAiAssisted: boolean;
  extractionStatus: string;
  isAmendment: boolean;
  extractedAt: string;
  updatedAt: string;
}

/**
 * 공시 본문 정량 fact (GET /disclosure-facts/:rcpNo 실연동, DAR-112).
 * DAR-95로 적재된 표준화 정량값(계약금액·전환가·배당성향 등).
 */
export interface FiledFact {
  rcpNo: string;
  corpCode: string;
  factKey: string;
  value: string;
  numericValue: number | null;
  unit: string | null;
  period: string | null;
  sectionPath: string | null;
  docType: string | null;
}

export interface DisclosureType {
  id: string;
  label: string;
  description: string;
  sortOrder: number;
}

/**
 * AI Task 식별자 — 백엔드 Prisma `AiTaskName` enum identifier(snake_case).
 * (DB 매핑은 kebab-case지만 클라이언트에 노출되는 값은 enum 식별자다.)
 */
export type AiAnalysisTask =
  | 'summary'
  | 'event_classification'
  | 'persona_interpretation'
  | 'position_thesis';

export interface DisclosureAnalysisItem {
  task: AiAnalysisTask | string;
  level: number;
  result: Record<string, unknown>;
  createdAt: string;
}

export interface PersonaAnalysis {
  result: Record<string, unknown>;
  createdAt: string;
}

/**
 * AI 분석 파이프라인 상태 (W10 기대치 관리 UX).
 * ready=산출물 존재 · pending=대상 이벤트 추출 완료, 순차 생성/익일 02:00 백필 대기 · excluded=분석 비대상.
 */
export type AiAnalysisStatus = 'ready' | 'pending' | 'excluded';

export interface DisclosureAnalysis {
  rcpNo: string;
  /** 구버전 서버는 미제공(optional) — 미제공 시 화면은 '대기'로 폴백. */
  analysisStatus?: AiAnalysisStatus;
  analyses: DisclosureAnalysisItem[];
  personaAnalysis: PersonaAnalysis | null;
}

/** 요약 Task 산출물 (Engine2 summary, L2). */
export interface SummaryResult {
  summary: string;
  positiveFactors: string[];
  negativeFactors: string[];
  polarity: 'POSITIVE' | 'NEGATIVE' | 'MIXED' | 'NEUTRAL' | string;
}

/** Persona 해석 Task 산출물 1건 (Engine2 persona-interpretation, L2). */
export interface PersonaViewResult {
  persona: 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE' | 'EVENT_DRIVEN' | string;
  interpretation: string;
  /** 0~100 — Persona 적합도(신뢰도 아님, 과신 방지 표기 필수). */
  fitScore: number;
}

/** Position Thesis Task 산출물 (Engine2 position-thesis, L3 — 매수 후보 한정). */
export interface PositionThesisResult {
  initialThesis: string;
  invalidConditions: string[];
  riskNotes: string;
}

// ─── 과거 유사공시 반응 통계 (GET /disclosures/:rcpNo/event-stats, DAR-511 BE / DAR-512 FE) ───
// 점수(권고)가 아니라 과거 사실(통계) — 같은 이벤트 유형 공시의 D+1/D+5/D+20 실제 주가 반응.
// n<30 유형은 stats=null+reason='INSUFFICIENT_SAMPLE'(소표본 허수 방지, BE 정직 게이트).

/** 단일 지평(D+N) 반응 요약. 백엔드 HorizonReaction 미러. */
export interface ReactionHorizon {
  /** 실제 주가 반응 — 종목 단순수익률 D0→D+N 누적 평균(%). */
  avgReturn: number;
  /** 시장 대비 초과수익(AR) D+N 누적 평균(%). 표본 결측 시 null. */
  avgAbnormalReturn: number | null;
  /** 상승비율 — 누적 단순수익률>0 관측치 비율(0~1). */
  winRate: number;
}

/** 이벤트 유형 반응 통계(n≥minSampleSize 게이트 통과 시). */
export interface ReactionStats {
  d1: ReactionHorizon;
  d5: ReactionHorizon;
  d20: ReactionHorizon;
}

/** 이벤트 유형별 반응 통계 결과. */
export interface DisclosureReactionResult {
  eventType: string;
  /** 집계 표본수 n. 관측치가 없으면 0. */
  sampleCount: number;
  /** n≥minSampleSize 통과 시 통계, 아니면 null. */
  stats: ReactionStats | null;
  /** stats=null 사유. 통과 시 null. */
  reason: 'INSUFFICIENT_SAMPLE' | null;
  /** 산출기간(YYYYMMDD). 표본 없으면 null. */
  period: { fromDate: string; toDate: string } | null;
  /** 기준일(관측치 최신 영속 시각 ISO). 표본 없으면 null. */
  calculatedAt: string | null;
}

/** GET /disclosures/:rcpNo/event-stats 응답 data. 이벤트 미추출 공시는 results=[]. */
export interface DisclosureReactionStatsResponse {
  rcpNo: string;
  /** 노출 최소 표본수(=30). n<이 값이면 통계 미표시(정직 게이트). */
  minSampleSize: number;
  /** 응답 생성 시각(ISO) — 일1회 캐시 표면. */
  generatedAt: string;
  results: DisclosureReactionResult[];
}
