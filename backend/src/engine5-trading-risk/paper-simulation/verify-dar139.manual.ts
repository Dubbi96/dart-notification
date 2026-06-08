/**
 * verify-dar139.manual.ts — DAR-139 DoD 동작 재현(읽기 전용, 라이브 DB).
 *
 * 증명: REAL_THEN_SYNTHETIC 모드에서 실데이터 보유 종목(126730/corp 00446901)이
 *   (A) 기본(연도 시프트 미설정) → 최신 실 거래일 종가 23,500 으로 평가(합성 83,050·stale 12,900 아님),
 *   (B) 시프트 명시(=1, 옵트인) → 1년 전 매핑가 12,900(과거 데이터 리플레이 모드, 비교용).
 *   + 보유 SIM 포지션을 23,500 으로 재평가했을 때의 평가손익·equity(현실적·~10M) 계산.
 *
 * ★읽기 전용 — DB 미변경(조회만). 실행: npx ts-node src/engine5-trading-risk/paper-simulation/verify-dar139.manual.ts
 */
import { PrismaClient } from '@prisma/client';
import { SimulationPriceSourceService } from './simulation-price-source.service';

const CORP = '00446901'; // 126730
const SIM_TODAY = '20260608';

async function evalWith(env: Record<string, string | undefined>, prisma: PrismaClient) {
  delete process.env.PAPER_SIM_SYNTHETIC_FEED;
  delete process.env.PAPER_SIM_REAL_FEED;
  delete process.env.PAPER_SIM_REAL_YEAR_OFFSET;
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  const svc = new SimulationPriceSourceService(prisma as never);
  const row = await svc.latestPriceRow(CORP, SIM_TODAY);
  return { mode: svc.mode, row };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    // (A) 기본(시프트 미설정) — DoD
    const a = await evalWith({ PAPER_SIM_REAL_FEED: '1' }, prisma);
    console.log(`[A] 기본(no-shift) mode=${a.mode} close=${a.row?.closePrice} source=${a.row?.source} sourceDate=${a.row?.sourceDate}`);

    // (B) 시프트 명시(=1, 비교용)
    const b = await evalWith({ PAPER_SIM_REAL_FEED: '1', PAPER_SIM_REAL_YEAR_OFFSET: '1' }, prisma);
    console.log(`[B] 시프트=1(replay) mode=${b.mode} close=${b.row?.closePrice} source=${b.row?.source} sourceDate=${b.row?.sourceDate}`);

    // 보유 SIM 포지션 — 기존 상태 + 내 수정(no-shift) 하의 runDailyCycle 재기준→스냅샷 예상 결과(읽기 전용 계산)
    const pos = await prisma.position.findFirst({
      where: { corpCode: CORP, status: 'OPEN' },
      select: { entryPrice: true, quantity: true, currentPrice: true, unrealizedPnlPct: true, entryDate: true },
    });
    if (pos && a.row) {
      console.log(
        `[POS-기존] entry=${pos.entryPrice} qty=${pos.quantity} currentPrice=${pos.currentPrice}(${pos.unrealizedPnlPct?.toFixed(1)}%) entryDate=${pos.entryDate.toISOString().slice(0, 10)}`,
      );
      // 1) 재기준(rebase): 진입일 시점 현재-소스(no-shift) 종가로 entry 재설정(drift>10%면).
      process.env.PAPER_SIM_REAL_FEED = '1';
      delete process.env.PAPER_SIM_REAL_YEAR_OFFSET;
      const svc = new SimulationPriceSourceService(prisma as never);
      const entryYmd =
        `${pos.entryDate.getFullYear()}${String(pos.entryDate.getMonth() + 1).padStart(2, '0')}${String(pos.entryDate.getDate()).padStart(2, '0')}`;
      const anchor = entryYmd <= SIM_TODAY ? entryYmd : SIM_TODAY;
      const srcRow = await svc.latestPriceRow(CORP, anchor);
      const srcEntry = srcRow!.closePrice;
      const drift = Math.abs(pos.entryPrice - srcEntry) / srcEntry;
      const rebasedEntry = drift > 0.1 ? srcEntry : pos.entryPrice;
      console.log(
        `[POS-재기준] 진입일(${anchor}) 실 종가=${srcEntry} drift=${(drift * 100).toFixed(1)}% → entry ${pos.entryPrice}→${rebasedEntry}${drift > 0.1 ? '(REBASE)' : '(멱등)'}`,
      );
      // 2) 스냅샷: 오늘 종가(no-shift)로 currentPrice/pnl 재평가.
      const close = a.row.closePrice;
      const value = close * pos.quantity;
      const pnl = (close - rebasedEntry) * pos.quantity;
      const pct = ((close - rebasedEntry) / rebasedEntry) * 100;
      const equity = 10_000_000 + pnl;
      console.log(
        `[POS-스냅샷] close=${close} value=${value} pnl=${Math.round(pnl)} pnl%=${pct.toFixed(2)} equity≈${Math.round(equity)} (현실적·~10M, 합성 +253% 제거)`,
      );
    } else {
      console.log('[POS] OPEN 포지션 없음(계산 생략)');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
