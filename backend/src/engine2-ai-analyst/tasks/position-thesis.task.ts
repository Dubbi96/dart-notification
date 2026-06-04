import { Injectable } from '@nestjs/common';
import { DisclosureSummaryDraft } from './summary.task';
import { PersonaAnalysisDraft } from './persona-interpretation.task';

export interface PositionThesisInput {
  rcpNo: string;
  signalId: string;
  summary: DisclosureSummaryDraft;
  personaViews: PersonaAnalysisDraft[];
  buyScore: number; // M6 산출물
  chartSummary?: string; // M4 지표 요약
}

export interface PositionThesisDraft {
  initialThesis: string; // 진입 논리
  invalidConditions: string[]; // 기계 평가 가능한 훼손 조건 (M7에서 검증)
  riskNotes: string;
}

/**
 * L3 — 실제 매수 후보(buyScore 높음)에만 실행하는 최고비용 Task.
 * 출력은 Engine4 PositionThesis 의 초안일 뿐, **최종 매수/주문 결정은 AI가 하지 않는다**(금지영역).
 */
@Injectable()
export class PositionThesisTask {
  async run(_input: PositionThesisInput): Promise<PositionThesisDraft> {
    // TODO(M7, phase-07): Thesis 초안 생성 + invalidConditions를 기계 평가 가능한 형태로 강제
    throw new Error('M3/M7 미구현: PositionThesisTask.run');
  }
}
