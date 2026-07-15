/**
 * Persona 철학 엔진 P-A — 순수 시드 코어 (SSOT)
 *
 * 4종 투자자 철학(버핏·린치·그린블라트·드러켄밀러)을 InvestorPhilosophy + 하위
 * metrics/sources 로 멱등 적재하는 순수 함수. Nest DI·Logger 미의존이라
 * ①독립 실행 스크립트(`prisma/seed-philosophy.ts`, PrismaClient 직접 생성)와
 * ②부팅 자동 시드 서비스(`philosophy-seeder.service.ts`, PrismaService DI)가
 * 동일 로직을 공유한다(중복 제거·동치 보장).
 *
 * 멱등 전략: philosophyId(자연키) upsert + 하위 row deleteMany→createMany 를
 * 철학별 트랜잭션으로 묶어 재실행 시 항상 동일 상태로 수렴한다.
 * AI 미개입(순수 데이터 적재). 스키마 변경 0.
 */
import { PrismaClient } from '@prisma/client';
import { InvestorPhilosophySeed } from './types/philosophy.types';

/**
 * 시드 트랜잭션에 필요한 Prisma 클라이언트 표면(스크립트·서비스 공용).
 * PrismaClient / PrismaService 둘 다 구조적으로 대입 가능하다.
 */
export type PhilosophySeedPrisma = Pick<PrismaClient, '$transaction'>;

/**
 * 주어진 철학 시드를 멱등 적재한다. 재실행해도 중복 삽입 없이 동일 상태로 수렴.
 * @returns 적재(upsert)한 철학 수
 */
export async function seedPhilosophiesInto(
  prisma: PhilosophySeedPrisma,
  seeds: readonly InvestorPhilosophySeed[],
): Promise<number> {
  for (const p of seeds) {
    await prisma.$transaction(async (tx) => {
      // 1) 마스터 upsert (멱등)
      await tx.investorPhilosophy.upsert({
        where: { philosophyId: p.philosophyId },
        create: {
          philosophyId: p.philosophyId,
          investorName: p.investorName,
          styleTags: p.styleTags,
          corePrinciples: p.corePrinciples,
          applicableAssets: p.applicableAssets,
          checklistItems: p.checklistItems,
          riskProfile: p.riskProfile,
          scoreFormula: p.scoreFormula ?? null,
        },
        update: {
          investorName: p.investorName,
          styleTags: p.styleTags,
          corePrinciples: p.corePrinciples,
          applicableAssets: p.applicableAssets,
          checklistItems: p.checklistItems,
          riskProfile: p.riskProfile,
          scoreFormula: p.scoreFormula ?? null,
        },
      });

      // 2) 하위 row 재구성 (deleteMany → createMany) — 중복삽입 방지
      await tx.philosophyMetric.deleteMany({
        where: { philosophyId: p.philosophyId },
      });
      await tx.philosophyMetric.createMany({
        data: p.metrics.map((m) => ({
          philosophyId: p.philosophyId,
          metricKey: m.metricKey,
          operator: m.operator,
          threshold: m.threshold,
          thresholdMax: m.thresholdMax ?? null,
          weight: m.weight,
          description: m.description,
        })),
      });

      await tx.philosophySource.deleteMany({
        where: { philosophyId: p.philosophyId },
      });
      await tx.philosophySource.createMany({
        data: p.sources.map((s) => ({
          philosophyId: p.philosophyId,
          type: s.type,
          title: s.title,
          year: s.year,
          url: s.url ?? null,
        })),
      });
    });
  }

  return seeds.length;
}
