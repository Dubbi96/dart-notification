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
  /**
   * Persona 해석 결과를 PersonaAnalysis 테이블(rcpNo 1:1)에 영속한다(upsert=멱등).
   * DAR-72 P-C 융합 엔진(PrismaPersonaViewRepository)이 **이 테이블만** 읽으므로,
   * personaViews 를 실제로 "충전"하려면 DisclosureAnalysis 외에 여기도 기록해야 한다(DAR-78).
   */
  abstract savePersonaViews(rcpNo: string, resultJson: unknown): Promise<void>;
  abstract saveUsage(usage: AiUsageLogParams & { createdAt: Date }): Promise<void>;
  /**
   * DAR-241: 멱등 캐시히트(비용0 재사용)를 경량 기록한다.
   * 실호출 비용 집계(getUsageSummary)에는 포함되지 않으며, getCacheHitCount 로만 관측한다 —
   * 캐시히트를 callCount/l0Ratio 분모에 섞으면 비용·L0 지표가 왜곡되기 때문.
   */
  abstract saveCacheHit(hit: CacheHitRecord): Promise<void>;
  /** DAR-241: 기간 내 캐시히트 횟수. health/metrics 의 적중률 관측 소스. */
  abstract getCacheHitCount(from: Date, to: Date): Promise<number>;
  abstract getUsageSummary(from: Date, to: Date): Promise<Array<{
    task: string;
    level: string;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
    rcpNo: string;
  }>>;
}

/** DAR-241: 캐시히트 1건 기록 단위(비용·토큰 없음 — 재사용 관측 전용). */
export interface CacheHitRecord {
  rcpNo: string;
  task: AiTaskName;
  level: AiCostLevel;
  createdAt: Date;
}
