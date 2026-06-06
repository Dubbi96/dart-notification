import 'dotenv/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SignalAccuracyService } from './signal-accuracy.service';

// 실 DB 동작 재현 — getSignalAccuracy read-only 집계가 라이브 신호/가격 데이터에 동작함을 확인. DAR-73.
// 실행: npx ts-node src/engine3-quant-market/backtest/signal-accuracy.manual.ts
async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  const svc = new SignalAccuracyService(prisma);
  const report = await svc.getSignalAccuracy({ limit: 500 });
  console.log('totalSignals:', report.totalSignals);
  console.log('realizedD5/D20:', report.realizedD5, '/', report.realizedD20);
  console.log('overall:', JSON.stringify(report.overall, null, 2));
  console.log('byGrade:', JSON.stringify(report.byGrade, null, 2));
  console.log(
    'byScoreBand:',
    JSON.stringify(report.byScoreBand, null, 2),
  );
  console.log('byEventType (top 5):', JSON.stringify(report.byEventType.slice(0, 5), null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
