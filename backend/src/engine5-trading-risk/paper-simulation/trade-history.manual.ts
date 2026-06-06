import 'dotenv/config';
import { PrismaService } from '../../prisma/prisma.service';
import { PaperSimulationService } from './paper-simulation.service';

// 실 DB 동작 재현 — getTradeHistory read-only 집계가 라이브 모의 포트폴리오에 동작함을 확인. DAR-64.
// 실행: npx ts-node src/engine5-trading-risk/paper-simulation/trade-history.manual.ts
async function main() {
  const prisma = new PrismaService();
  await prisma.$connect();
  // paperTrade 는 getTradeHistory 경로에서 미사용 — 형식상 null 주입(read-only 데모).
  const sim = new PaperSimulationService(prisma, null as never);
  const data = await sim.getTradeHistory();
  console.log('scorecard:', JSON.stringify(data.scorecard, null, 2));
  console.log('tradeCount:', data.trades.length);
  console.log('sample trades:', JSON.stringify(data.trades.slice(0, 3), null, 2));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
