import { Injectable } from '@nestjs/common';
import { Polarity } from '../types/ai-analyst.types';

export interface SummaryTaskInput {
  rcpNo: string;
  eventType: string;
  keyMetrics: Record<string, unknown>;
  /** 원문 핵심 단락만 (≤ 2,000 토큰). 원문 전문 금지 — 입력 최소화 계약 */
  excerpt: string;
}

export interface DisclosureSummaryDraft {
  summary: string;
  positiveFactors: string[];
  negativeFactors: string[];
  polarity: Polarity;
}

/** L2 — 공시 요약·핵심 포인트 추출. JSON mode 강제·필드 화이트리스트 검증. */
@Injectable()
export class SummaryTask {
  async run(_input: SummaryTaskInput): Promise<DisclosureSummaryDraft> {
    // TODO(M3, phase-04): LLM 클라이언트 + 최소입력 프롬프트 + JSON 스키마 강제 + rcpNo+task 멱등 캐시
    throw new Error('M3 미구현: SummaryTask.run');
  }
}
