import { Injectable } from '@nestjs/common';

export interface EventClassificationInput {
  rcpNo: string;
  reportName: string;
  ruleEventType: string; // Engine1 Rule 분류 결과 (1차)
  excerpt: string;
}

export interface EventClassificationDraft {
  eventType: string; // AI 보정 결과
  confidence: number; // 0~1
  changedFromRule: boolean; // Rule 분류와 달라졌는지 (불일치율 모니터링)
}

/**
 * L1(보조) — 이벤트 타입 1차 분류는 Engine1의 Rule(정규식·키워드)이 담당하고,
 * **모호한 공시만** 이 Task가 보정한다. Rule 대비 불일치율은 회귀 항목(M3 ↩︎ M2).
 */
@Injectable()
export class EventClassificationTask {
  async run(_input: EventClassificationInput): Promise<EventClassificationDraft> {
    // TODO(M3, phase-04): 저비용 모델 보정 호출 + 불일치 로깅
    throw new Error('M3 미구현: EventClassificationTask.run');
  }
}
