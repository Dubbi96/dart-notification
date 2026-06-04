import { AiCostLevel, AiTaskName, AiUsageLogParams } from '../types/ai-analyst.types';

/** 저장된 분석 결과 (멱등 캐시 단위 — rcpNo + task) */
export interface StoredAnalysis {
  rcpNo: string;
  task: AiTaskName;
  level: AiCostLevel;
  resultJson: unknown;
  createdAt: Date;
}

/**
 * AI 분석/사용량 영속 포트(추상).
 * - 멱등 캐시: rcpNo + task 로 중복 호출 방지
 * - 사용량 기록: 비용 거버넌스 토대
 *
 * 구현 어댑터:
 *  - InMemoryAiAnalysisRepository (현재, 테스트·개발)
 *  - PrismaAiAnalysisRepository  (다음 증분 — DisclosureAnalysis/PersonaAnalysis/AIUsageLog 모델 + 마이그레이션 필요)
 */
export abstract class AiAnalysisRepository {
  abstract findAnalysis(rcpNo: string, task: AiTaskName): Promise<StoredAnalysis | null>;
  abstract saveAnalysis(analysis: StoredAnalysis): Promise<void>;
  abstract saveUsage(usage: AiUsageLogParams & { createdAt: Date }): Promise<void>;
}
