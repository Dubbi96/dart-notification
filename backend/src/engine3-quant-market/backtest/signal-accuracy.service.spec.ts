/**
 * signal-accuracy.service.spec.ts — 신호 사후검증 서비스의 가격→실현 AR 배선 검증 (DAR-73)
 *
 * 실 DB(dev)는 marketIndex 표본이 사실상 비어 있고 최신 신호뿐이라 실현수익이 0건이다.
 * 여기서는 mock Prisma 로 가격/시장지수를 주입해 calcAR 배선이 D+5/D+20 실현 초과수익을
 * 실제로 산출함을 결정론적으로 증명한다(가격 부족 시 null 폴백 포함).
 * TB-2(2026-07-03): 표본 설계 배선 — (rcpNo,eventType) dedup·rcpDt 기간 필터(from/to)·
 * 월별 층화·결정론 정렬(persona ASC 대표행)이 조회/집계에 반영됨을 함께 검증한다.
 */
import { SignalAccuracyService } from './signal-accuracy.service';

/** YYYYMMDD 연속 거래일(주말 무시 — 테스트용 단순 증가) n개 생성 */
function seqDates(start: string, n: number): string[] {
  const y = +start.slice(0, 4);
  const m = +start.slice(4, 6);
  const d = +start.slice(6, 8);
  const out: string[] = [];
  const dt = new Date(Date.UTC(y, m - 1, d));
  for (let i = 0; i < n; i++) {
    const yy = dt.getUTCFullYear();
    const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(dt.getUTCDate()).padStart(2, '0');
    out.push(`${yy}${mm}${dd}`);
    dt.setUTCDate(dt.getUTCDate() + 1);
  }
  return out;
}

function makePrisma(opts: {
  signals: Array<{
    /** 미지정 시 인덱스별 고유 rcpNo (dedup 과 무관하게 각 행이 별도 표본) */
    rcpNo?: string;
    persona?: string;
    stockCode: string;
    eventType: string;
    buyScore: number;
    signal: string;
    rcpDt: string | null;
    market: string | null;
  }>;
  stockRows: Array<{ tradeDate: string; closePrice: number }>;
  marketRows: Array<{ tradeDate: string; closeIndex: number }>;
}) {
  // TB-2: 조회 인자(where/orderBy/take) 검증용 캡처. mock 은 필터를 적용하지 않고
  // 전 행을 반환한다(dedup·층화는 서비스의 순수 함수 단계에서 검증).
  const signalFindManyArgs: Array<Record<string, unknown>> = [];
  const prisma = {
    tradingSignal: {
      findMany: async (args: Record<string, unknown>) => {
        signalFindManyArgs.push(args);
        return opts.signals.map((s, i) => ({
          rcpNo: s.rcpNo ?? `R${i}`,
          stockCode: s.stockCode,
          eventType: s.eventType,
          buyScore: s.buyScore,
          signal: s.signal,
          persona: s.persona ?? 'GROWTH',
          disclosure: s.rcpDt ? { rcpDt: s.rcpDt } : null,
          company: { market: s.market },
        }));
      },
    },
    stockDailyPrice: { findMany: async () => opts.stockRows },
    marketIndex: { findMany: async () => opts.marketRows },
  } as never;
  return { prisma, signalFindManyArgs };
}

describe('SignalAccuracyService (가격→실현 AR 배선)', () => {
  it('충분한 가격/시장지수가 있으면 D+5/D+20 실현 초과수익을 산출', async () => {
    const dates = seqDates('20250101', 22); // D0..D+21
    // 종목: 매일 +1% 상승, 시장: 보합 → 누적 초과수익(AR) > 0
    const stockRows = dates.map((tradeDate, i) => ({
      tradeDate,
      closePrice: Math.round(1000 * Math.pow(1.01, i)),
    }));
    const marketRows = dates.map((tradeDate) => ({ tradeDate, closeIndex: 2000 }));

    const { prisma } = makePrisma({
      signals: [
        {
          stockCode: '005930',
          eventType: 'SUPPLY_CONTRACT',
          buyScore: 85,
          signal: 'STRONG_BUY_CANDIDATE',
          rcpDt: '20250101',
          market: 'KOSPI',
        },
      ],
      stockRows,
      marketRows,
    });
    const svc = new SignalAccuracyService(prisma);

    const report = await svc.getSignalAccuracy();
    expect(report.totalSignals).toBe(1);
    expect(report.realizedD5).toBe(1);
    expect(report.realizedD20).toBe(1);

    const strong = report.byGrade.find((b) => b.key === 'STRONG_BUY_CANDIDATE')!;
    expect(strong.d5.sampleCount).toBe(1);
    expect(strong.d5.avgExcessReturn).not.toBeNull();
    expect(strong.d5.avgExcessReturn!).toBeGreaterThan(0); // 상승 종목 vs 보합 시장
    expect(strong.d20.avgExcessReturn!).toBeGreaterThan(strong.d5.avgExcessReturn!); // 더 길수록 누적↑
    expect(report.byScoreBand[0].key).toBe('50+ (STRONG_BUY)');
  });

  it('가격이 D+5 미만이면 두 지평 모두 null(과신 방지 폴백)', async () => {
    const dates = seqDates('20250101', 4); // D0..D+3 (6개 미만)
    const stockRows = dates.map((tradeDate, i) => ({ tradeDate, closePrice: 1000 + i }));
    const marketRows = dates.map((tradeDate) => ({ tradeDate, closeIndex: 2000 }));
    const { prisma } = makePrisma({
      signals: [
        { stockCode: 'X', eventType: 'E', buyScore: 70, signal: 'BUY_CANDIDATE', rcpDt: '20250101', market: 'KOSPI' },
      ],
      stockRows,
      marketRows,
    });
    const svc = new SignalAccuracyService(prisma);
    const report = await svc.getSignalAccuracy();
    expect(report.realizedD5).toBe(0);
    expect(report.realizedD20).toBe(0);
    expect(report.byGrade[0].d5.avgExcessReturn).toBeNull();
  });

  it('disclosure rcpDt 또는 market 이 없으면 null', async () => {
    const dates = seqDates('20250101', 22);
    const stockRows = dates.map((tradeDate, i) => ({ tradeDate, closePrice: 1000 + i }));
    const marketRows = dates.map((tradeDate) => ({ tradeDate, closeIndex: 2000 }));
    const { prisma } = makePrisma({
      signals: [
        { stockCode: 'X', eventType: 'E', buyScore: 70, signal: 'BUY_CANDIDATE', rcpDt: null, market: 'KOSPI' },
        { stockCode: 'Y', eventType: 'E', buyScore: 70, signal: 'BUY_CANDIDATE', rcpDt: '20250101', market: null },
      ],
      stockRows,
      marketRows,
    });
    const svc = new SignalAccuracyService(prisma);
    const report = await svc.getSignalAccuracy();
    expect(report.totalSignals).toBe(2);
    expect(report.realizedD5).toBe(0); // 둘 다 실현 불가
  });
});

// ── TB-2 (2026-07-03) — 표본 설계 배선: dedup·기간 필터·층화·결정론 정렬 ──────

describe('SignalAccuracyService — TB-2 표본 설계', () => {
  const base = {
    stockCode: 'X',
    buyScore: 70,
    signal: 'BUY_CANDIDATE',
    market: 'KOSPI' as const,
  };

  it('동일 (rcpNo,eventType) persona 4행은 대표 1행으로 dedup(4배 유사복제 제거)', async () => {
    const { prisma } = makePrisma({
      signals: ['EVENT_DRIVEN', 'GROWTH', 'MOMENTUM', 'VALUE'].map((persona) => ({
        ...base,
        rcpNo: 'R1',
        persona,
        eventType: 'SUPPLY_CONTRACT',
        rcpDt: '20250601',
      })),
      stockRows: [],
      marketRows: [],
    });
    const svc = new SignalAccuracyService(prisma);
    const report = await svc.getSignalAccuracy();
    expect(report.totalSignals).toBe(1); // 종전엔 4 (persona 복제)
  });

  it('rcpDt 기간 필터(from/to 종일 ceil)·결정론 정렬(persona ASC)이 조회에 반영', async () => {
    const { prisma, signalFindManyArgs } = makePrisma({
      signals: [],
      stockRows: [],
      marketRows: [],
    });
    const svc = new SignalAccuracyService(prisma);
    await svc.getSignalAccuracy({ from: '20250101', to: '20251231' });

    const args = signalFindManyArgs[0] as {
      where: { disclosure: { rcpDt: { gte: string; lte: string } } };
      orderBy: unknown;
    };
    expect(args.where.disclosure.rcpDt).toEqual({
      gte: '20250101',
      lte: '20251231999999', // YYYYMMDDHHmmss 종일 포함(백필 경로와 동일 규약)
    });
    // 결정론 정렬 — dedup 대표행 = 사전순 첫 persona.
    expect(args.orderBy).toEqual([
      { rcpNo: 'asc' },
      { eventType: 'asc' },
      { persona: 'asc' },
    ]);
  });

  it('from/to 미지정·무효 시 기본 기간(최근 12개월, YYYYMMDD)으로 폴백', async () => {
    const { prisma, signalFindManyArgs } = makePrisma({
      signals: [],
      stockRows: [],
      marketRows: [],
    });
    const svc = new SignalAccuracyService(prisma);
    await svc.getSignalAccuracy(); // 미지정
    await svc.getSignalAccuracy({ from: '2025-01-01', to: 'bad' }); // 무효 형식

    for (const raw of signalFindManyArgs) {
      const args = raw as { where: { disclosure: { rcpDt: { gte: string; lte: string } } } };
      const { gte, lte } = args.where.disclosure.rcpDt;
      expect(gte).toMatch(/^\d{8}$/);
      expect(lte).toMatch(/^\d{8}999999$/);
      expect(gte < lte.slice(0, 8)).toBe(true); // from(12개월 전) < to(오늘)
    }
  });

  it('limit 이 dedup 표본보다 작으면 월별 층화(각 월 균등 추출)', async () => {
    const { prisma } = makePrisma({
      signals: [
        // 202501 월 3건 + 202506 월 1건 (rcpNo·eventType 로 각기 다른 공시이벤트)
        { ...base, rcpNo: 'A1', eventType: 'E1', rcpDt: '20250103' },
        { ...base, rcpNo: 'A2', eventType: 'E2', rcpDt: '20250110' },
        { ...base, rcpNo: 'A3', eventType: 'E3', rcpDt: '20250120' },
        { ...base, rcpNo: 'B1', eventType: 'E4', rcpDt: '20250602' },
      ],
      stockRows: [],
      marketRows: [],
    });
    const svc = new SignalAccuracyService(prisma);
    const report = await svc.getSignalAccuracy({ limit: 2 });

    // 라운드로빈 1바퀴: 각 월 첫 행(E1, E4) — 최신월 쏠림 없이 균등.
    expect(report.totalSignals).toBe(2);
    const eventTypes = report.byEventType.map((b) => b.key).sort();
    expect(eventTypes).toEqual(['E1', 'E4']);
  });
});
