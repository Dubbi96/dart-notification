/**
 * Persona 철학 엔진 P-A — 시드 스크립트 (DAR-48)
 *
 * 4종 투자자 철학(버핏·린치·그린블라트·드러켄밀러)을 InvestorPhilosophy + 하위
 * metrics/sources 로 멱등 적재한다. 재실행해도 중복 삽입 없이 동일 상태로 수렴한다.
 *
 * ⚠️ DB 반영(적용)은 휴먼 승인 사항. 마이그레이션 적용 후 사용자가 실행한다:
 *     npm run seed:philosophy
 *
 * 시드 로직 SSOT 는 philosophy-seeder.core.ts(`seedPhilosophiesInto`)이며,
 * 부팅 자동 시드 서비스(PhilosophySeederService)와 동일 로직을 공유한다.
 * 이 스크립트는 무조건(비어있지 않아도) 재적재하는 수동 운영 경로다.
 */
import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import { PHILOSOPHY_SEEDS } from '../src/engine2-ai-analyst/philosophy/philosophy.seed-data';
import { seedPhilosophiesInto } from '../src/engine2-ai-analyst/philosophy/philosophy-seeder.core';

dotenv.config();

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('투자자 철학 시드(P-A) 적재 시작...');
  const seeded = await seedPhilosophiesInto(prisma, PHILOSOPHY_SEEDS);
  console.log(`  ✓ 철학 ${seeded}종 멱등 적재(upsert + metrics/sources 재구성)`);
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
