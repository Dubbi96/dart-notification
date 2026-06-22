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

export interface DisclosureAnalysis {
  rcpNo: string;
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
