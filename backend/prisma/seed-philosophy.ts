/**
 * Persona 철학 엔진 P-A — 시드 스크립트 (DAR-48)
 *
 * 4종 투자자 철학(버핏·린치·그린블라트·드러켄밀러)을 InvestorPhilosophy + 하위
 * metrics/sources 로 멱등 적재한다. 재실행해도 중복 삽입 없이 동일 상태로 수렴한다.
 *
 * ⚠️ DB 반영(적용)은 휴먼 승인 사항. 마이그레이션 적용 후 사용자가 실행한다:
 *     npm run seed:philosophy
 *
 * 멱등 전략: philosophyId(자연키) upsert + 하위 row deleteMany→createMany 를
 * 트랜잭션으로 묶어 재실행 시 항상 동일 상태가 되도록 한다.
 */
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import { PHILOSOPHY_SEEDS } from '../src/engine2-ai-analyst/philosophy/philosophy.seed-data';

dotenv.config();

const prisma = new PrismaClient();

async function seedPhilosophies(): Promise<void> {
  for (const p of PHILOSOPHY_SEEDS) {
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
      await tx.philosophyMetric.deleteMany({ where: { philosophyId: p.philosophyId } });
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

      await tx.philosophySource.deleteMany({ where: { philosophyId: p.philosophyId } });
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

    console.log(`  ✓ ${p.philosophyId} (${p.investorName}) — metrics ${p.metrics.length}, sources ${p.sources.length}`);
  }
}

async function main(): Promise<void> {
  console.log('투자자 철학 시드(P-A) 적재 시작...');
  await seedPhilosophies();
  const count = await prisma.investorPhilosophy.count();
  console.log(`완료: InvestorPhilosophy ${count}건`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
