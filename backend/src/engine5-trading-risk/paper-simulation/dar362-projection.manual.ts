/**
 * dar362-projection.manual.ts — DAR-362 실측(read-only) 프로젝션
 *
 * 실 DB(live)의 현재 OPEN 포지션 + 후보 pool에 대해, 신규 사이징/섹터/풀확대 로직이
 * "이전(균일)"을 어떻게 바꾸는지 결정론적으로 산출한다. ★DB 쓰기 0(SELECT만) — 프로덕션 무변경.
 *   실행: npx -y tsx@4 src/engine5-trading-risk/paper-simulation/dar362-projection.manual.ts
 */
import { PrismaClient } from '@prisma/client';
import {
  SIM_MIN_ENTRY_GRADE,
  entryEligibleGrades,
  entryBudget,
  entryBudgetScored,
  dedupeCandidatesByCorpCode,
  sectorHeadroomBudget,
  ENTRY_FALLBACK_MIN_BUY_SCORE,
} from './simulation-entry';

const INITIAL_CAPITAL = 10_000_000;
const MAX_HOLDINGS = 50;
const SIM_EMAIL = 'paper-sim@system.local';
const SIM_PF_NAME = '모의운용 포트폴리오';

function stats(xs: number[]) {
  if (xs.length === 0) return { n: 0, min: 0, median: 0, max: 0, stdev: 0, cv: 0 };
  const s = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
  const stdev = Math.sqrt(variance);
  return {
    n: xs.length,
    min: s[0],
    median: s[Math.floor(s.length / 2)],
    max: s[s.length - 1],
    stdev: Math.round(stdev),
    cv: mean > 0 ? +(stdev / mean).toFixed(3) : 0,
  };
}

async function main() {
  const p = new PrismaClient();
  const user = await p.user.findFirst({ where: { email: SIM_EMAIL }, select: { id: true } });
  const pf = user
    ? await p.portfolio.findFirst({
        where: { userId: user.id, name: SIM_PF_NAME },
        select: { id: true, maxSinglePositionPct: true, maxSectorPct: true },
      })
    : null;
  const maxSingle = pf?.maxSinglePositionPct ?? 10;
  const maxSector = pf?.maxSectorPct ?? 30;
  const baseBudget = INITIAL_CAPITAL * (maxSingle / 100);

  const openPositions = pf
    ? await p.position.findMany({
        where: { portfolioId: pf.id, status: 'OPEN' },
        select: { corpCode: true, currentValue: true, entryAmount: true },
      })
    : [];
  const openCorpCodes = openPositions.map((o) => o.corpCode);
  const available = MAX_HOLDINGS - openPositions.length;

  // ── (A) 현재 OPEN 포지션 가치 분포(이전 = 균일?) ──
  const openVals = openPositions.map((o) => o.currentValue ?? o.entryAmount ?? 0);
  console.log('=== (A) 현재 OPEN 포지션 ===');
  console.log('count:', openPositions.length, 'value stats:', stats(openVals));

  // ── (B) 후보 pool: entryReady → 부족분 비-entryReady 상위 buyScore ──
  const eligible = entryEligibleGrades(SIM_MIN_ENTRY_GRADE) as never;
  const excl = openCorpCodes.length ? openCorpCodes : ['__none__'];
  const readyRaw = await p.tradingSignal.findMany({
    where: { signal: { in: eligible }, entryReady: true, corpCode: { notIn: excl } },
    orderBy: { buyScore: 'desc' },
    take: available * 4,
    select: { id: true, corpCode: true, stockCode: true, signal: true, buyScore: true },
  });
  let candidates = dedupeCandidatesByCorpCode(readyRaw).slice(0, available);
  const readyOnlyCount = candidates.length;
  if (candidates.length < available) {
    const need = available - candidates.length;
    const already = new Set<string>([...openCorpCodes, ...candidates.map((c) => c.corpCode)]);
    const fbRaw = await p.tradingSignal.findMany({
      where: {
        signal: { in: eligible },
        entryReady: false,
        buyScore: { gte: ENTRY_FALLBACK_MIN_BUY_SCORE },
        corpCode: { notIn: Array.from(already).length ? Array.from(already) : ['__none__'] },
      },
      orderBy: { buyScore: 'desc' },
      take: need * 4,
      select: { id: true, corpCode: true, stockCode: true, signal: true, buyScore: true },
    });
    const fb = dedupeCandidatesByCorpCode(fbRaw).filter((c) => !already.has(c.corpCode)).slice(0, need);
    candidates = [...candidates, ...fb];
  }
  console.log('\n=== (B) 후보 pool 확대 ===');
  console.log('available slots:', available);
  console.log('entryReady만:', readyOnlyCount, '→ 확대 후 후보:', candidates.length);

  // ── (C) 사이징: 이전(등급만, 균일) vs 신규(등급×buyScore) — 실가 기준 주수 ──
  const codes = candidates.map((c) => c.corpCode);
  const priceRows = await p.stockDailyPrice.findMany({
    where: { corpCode: { in: codes } },
    orderBy: { tradeDate: 'desc' },
    select: { corpCode: true, closePrice: true, tradeDate: true },
  });
  const priceByCorp = new Map<string, number>();
  for (const r of priceRows) if (!priceByCorp.has(r.corpCode)) priceByCorp.set(r.corpCode, r.closePrice);

  // 섹터 매핑
  const sectorByCorp = new Map<string, string | null>();
  const ovs = await p.companyOverview.findMany({
    where: { corpCode: { in: [...codes, ...openCorpCodes] } },
    select: { corpCode: true, industryCode: true },
  });
  for (const o of ovs) sectorByCorp.set(o.corpCode, o.industryCode ?? null);

  const oldAmts: number[] = [];
  const newAmts: number[] = [];
  const sectorValue = new Map<string, number>();
  for (const o of openPositions) {
    const s = sectorByCorp.get(o.corpCode) ?? null;
    if (!s) continue;
    sectorValue.set(s, (sectorValue.get(s) ?? 0) + (o.currentValue ?? o.entryAmount ?? 0));
  }
  const newSectorDist: Record<string, number> = {};
  let sectorCapped = 0;
  for (const c of candidates) {
    const price = priceByCorp.get(c.corpCode);
    if (!price || price <= 0) continue;
    const oldBudget = entryBudget(baseBudget, c.signal);
    let newBudget = entryBudgetScored(baseBudget, c.signal, c.buyScore);
    const sector = sectorByCorp.get(c.corpCode) ?? null;
    if (sector) {
      const headroom = sectorHeadroomBudget(sectorValue.get(sector) ?? 0, INITIAL_CAPITAL, maxSector);
      const before = newBudget;
      newBudget = Math.min(newBudget, headroom);
      if (newBudget < before) sectorCapped++;
    }
    const oldShares = Math.floor(oldBudget / price);
    const newShares = Math.floor(newBudget / price);
    if (oldShares > 0) oldAmts.push(oldShares * price);
    if (newShares > 0) {
      newAmts.push(newShares * price);
      const k = sector ?? '(섹터미상)';
      newSectorDist[k] = (newSectorDist[k] ?? 0) + 1;
      if (sector) sectorValue.set(sector, (sectorValue.get(sector) ?? 0) + newShares * price);
    }
  }
  console.log('\n=== (C) 차등 사이징(실가 기준 진입금액) ===');
  console.log('이전(등급만): ', stats(oldAmts));
  console.log('신규(등급×score):', stats(newAmts));
  console.log('  → CV(변동계수) 이전', stats(oldAmts).cv, '→ 신규', stats(newAmts).cv, '(클수록 차등 큼)');

  console.log('\n=== (D) 섹터 분산 가드 ===');
  console.log('maxSectorPct:', maxSector, '%  cap(원):', INITIAL_CAPITAL * (maxSector / 100));
  console.log('섹터캡으로 예산 절감된 후보 수:', sectorCapped);
  console.log('신규 진입 섹터 분포(industryCode):', JSON.stringify(newSectorDist));
  console.log('  ⚠ CompanyOverview industryCode 적재율 낮음 → 대부분 (섹터미상)=가드 면제(데이터 의존).');

  await p.$disconnect();
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
