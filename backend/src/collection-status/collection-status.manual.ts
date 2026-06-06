import 'dotenv/config';
import { PrismaService } from '../prisma/prisma.service';
import { CollectionStatusService } from './collection-status.service';

// 실 DB 동작 재현 — read-only 집계가 라이브 데이터에 대해 동작함을 확인. DAR-63.
// 실행: npx ts-node src/collection-status/collection-status.manual.ts
async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  const service = new CollectionStatusService(prisma);
  const result = await service.getStatus();
  // logger.log 은 컨텍스트 부팅 없이도 보장 안되므로 console.log 사용(데모 출력).
  console.log(JSON.stringify(result, null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
