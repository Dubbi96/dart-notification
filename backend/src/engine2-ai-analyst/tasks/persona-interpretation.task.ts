import { Injectable } from '@nestjs/common';
import { DisclosureSummaryDraft } from './summary.task';

export type PersonaType = 'CONSERVATIVE' | 'BALANCED' | 'AGGRESSIVE' | 'EVENT_DRIVEN';

export interface PersonaInterpretationInput {
  rcpNo: string;
  summary: DisclosureSummaryDraft; // Summary Task 산출물을 입력으로 (원문 재투입 금지)
  personas: PersonaType[];
}

export interface PersonaAnalysisDraft {
  persona: PersonaType;
  interpretation: string;
  fitScore: number; // 0~100 — Persona 적합도
}

/** L2 — Persona 4종 관점별 해석. Summary 산출물을 입력으로 받아 입력 최소화. */
@Injectable()
export class PersonaInterpretationTask {
  async run(_input: PersonaInterpretationInput): Promise<PersonaAnalysisDraft[]> {
    // TODO(M3, phase-04): Persona별 프롬프트 + JSON 배열 스키마 강제
    throw new Error('M3 미구현: PersonaInterpretationTask.run');
  }
}
