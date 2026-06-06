/**
 * Persona 철학 엔진 P-A — 조회 포트 (DAR-48)
 *
 * P-B PhilosophyScoreService 가 의존할 읽기 위주 인터페이스 골격.
 * 순수 조회만 정의(쓰기는 시드 스크립트가 담당) — AI 미개입.
 * 로드맵: docs/roadmap/cc-persona-philosophy-engine.md §4 P-A·P-B
 */
import {
  PhilosophyMetricOperator,
  PhilosophySourceType,
} from '../types/philosophy.types';

/** 조회 모델: 철학 + 지표/출처 (P-B 스코어러 입력) */
export interface PhilosophyMetricView {
  metricKey: string;
  operator: PhilosophyMetricOperator;
  threshold: number;
  thresholdMax: number | null;
  weight: number;
  description: string;
}

export interface PhilosophySourceView {
  type: PhilosophySourceType;
  title: string;
  year: number;
  url: string | null;
}

export interface PhilosophyView {
  philosophyId: string;
  investorName: string;
  styleTags: string[];
  corePrinciples: string[];
  applicableAssets: string[];
  checklistItems: string[];
  riskProfile: string;
  scoreFormula: string | null;
  metrics: PhilosophyMetricView[];
  sources: PhilosophySourceView[];
}

/**
 * 투자자 철학 조회 포트(추상). 읽기 전용.
 *
 * 구현 어댑터:
 *  - PrismaPhilosophyRepository (Prisma 읽기)
 */
export abstract class PhilosophyRepository {
  /** 전체 철학 목록 (지표·출처 포함) */
  abstract findAll(): Promise<PhilosophyView[]>;

  /** 식별자로 단건 조회 (없으면 null) */
  abstract findById(philosophyId: string): Promise<PhilosophyView | null>;

  /** 스타일 태그로 필터 (예: 'VALUE') */
  abstract findByStyleTag(styleTag: string): Promise<PhilosophyView[]>;
}
