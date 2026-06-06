/**
 * Persona 철학 엔진 P-A — Prisma 조회 어댑터 (DAR-48)
 *
 * 읽기 전용. InvestorPhilosophy + metrics + sources 를 조회해 PhilosophyView 로 매핑.
 * 쓰기는 prisma/seed-philosophy.ts(멱등 시드)가 담당하므로 여기서는 노출하지 않는다.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  PhilosophyRepository,
  PhilosophyView,
} from '../ports/philosophy.repository';
import {
  PhilosophyMetricOperator,
  PhilosophySourceType,
} from '../types/philosophy.types';

/** Prisma row 형태(필요 필드만) — 생성 클라이언트 타입 의존을 줄이기 위한 구조적 타입 */
interface PhilosophyRow {
  philosophyId: string;
  investorName: string;
  styleTags: string[];
  corePrinciples: string[];
  applicableAssets: string[];
  checklistItems: string[];
  riskProfile: string;
  scoreFormula: string | null;
  metrics: Array<{
    metricKey: string;
    operator: string;
    threshold: number;
    thresholdMax: number | null;
    weight: number;
    description: string;
  }>;
  sources: Array<{
    type: string;
    title: string;
    year: number;
    url: string | null;
  }>;
}

const INCLUDE_RELATIONS = {
  metrics: { orderBy: { weight: 'desc' as const } },
  sources: { orderBy: { year: 'asc' as const } },
};

function toView(row: PhilosophyRow): PhilosophyView {
  return {
    philosophyId: row.philosophyId,
    investorName: row.investorName,
    styleTags: row.styleTags,
    corePrinciples: row.corePrinciples,
    applicableAssets: row.applicableAssets,
    checklistItems: row.checklistItems,
    riskProfile: row.riskProfile,
    scoreFormula: row.scoreFormula,
    metrics: row.metrics.map((m) => ({
      metricKey: m.metricKey,
      operator: m.operator as PhilosophyMetricOperator,
      threshold: m.threshold,
      thresholdMax: m.thresholdMax,
      weight: m.weight,
      description: m.description,
    })),
    sources: row.sources.map((s) => ({
      type: s.type as PhilosophySourceType,
      title: s.title,
      year: s.year,
      url: s.url,
    })),
  };
}

@Injectable()
export class PrismaPhilosophyRepository extends PhilosophyRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findAll(): Promise<PhilosophyView[]> {
    const rows = await this.prisma.investorPhilosophy.findMany({
      include: INCLUDE_RELATIONS,
      orderBy: { philosophyId: 'asc' },
    });
    return (rows as unknown as PhilosophyRow[]).map(toView);
  }

  async findById(philosophyId: string): Promise<PhilosophyView | null> {
    const row = await this.prisma.investorPhilosophy.findUnique({
      where: { philosophyId },
      include: INCLUDE_RELATIONS,
    });
    return row ? toView(row as unknown as PhilosophyRow) : null;
  }

  async findByStyleTag(styleTag: string): Promise<PhilosophyView[]> {
    const rows = await this.prisma.investorPhilosophy.findMany({
      where: { styleTags: { has: styleTag } },
      include: INCLUDE_RELATIONS,
      orderBy: { philosophyId: 'asc' },
    });
    return (rows as unknown as PhilosophyRow[]).map(toView);
  }
}
