export interface Disclosure {
  rcpNo: string;
  corpCode: string;
  corpName: string;
  reportName: string;
  rcpDt: string;
  flrName: string;
  rmk: string;
  disclosureType: string;
  createdAt: string;
  dartUrl?: string;
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

export interface DisclosureType {
  id: string;
  label: string;
  description: string;
  sortOrder: number;
}

export interface DisclosureAnalysisItem {
  task: string;
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
