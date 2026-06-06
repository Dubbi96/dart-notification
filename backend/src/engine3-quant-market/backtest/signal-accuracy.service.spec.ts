/**
 * signal-accuracy.service.spec.ts — 신호 사후검증 서비스의 가격→실현 AR 배선 검증 (DAR-73)
 *
 * 실 DB(dev)는 marketIndex 표본이 사실상 비어 있고 최신 신호뿐이라 실현수익이 0건이다.
 * 여기서는 mock Prisma 로 가격/시장지수를 주입해 calcAR 배선이 D+5/D+20 실현 초과수익을
 * 실제로 산출함을 결정론적으로 증명한다(가격 부족 시 null 폴백 포함).
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
  return {
    tradingSignal: {
      findMany: async () =>
        opts.signals.map((s) => ({
          rcpNo: 'R',
          stockCode: s.stockCode,
          eventType: s.eventType,
          buyScore: s.buyScore,
          signal: s.signal,
          disclosure: s.rcpDt ? { rcpDt: s.rcpDt } : null,
          company: { market: s.market },
        })),
    },
    stockDailyPrice: { findMany: async () => opts.stockRows },
    marketIndex: { findMany: async () => opts.marketRows },
  } as never;
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

    const svc = new SignalAccuracyService(
      makePrisma({
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
      }),
    );

    const report = await svc.getSignalAccuracy();
    expect(report.totalSignals).toBe(1);
    expect(report.realizedD5).toBe(1);
    expect(report.realizedD20).toBe(1);

    const strong = report.byGrade.find((b) => b.key === 'STRONG_BUY_CANDIDATE')!;
    expect(strong.d5.sampleCount).toBe(1);
    expect(strong.d5.avgExcessReturn).not.toBeNull();
    expect(strong.d5.avgExcessReturn!).toBeGreaterThan(0); // 상승 종목 vs 보합 시장
    expect(strong.d20.avgExcessReturn!).toBeGreaterThan(strong.d5.avgExcessReturn!); // 더 길수록 누적↑
    expect(report.byScoreBand[0].key).toBe('80+ (STRONG_BUY)');
  });

  it('가격이 D+5 미만이면 두 지평 모두 null(과신 방지 폴백)', async () => {
    const dates = seqDates('20250101', 4); // D0..D+3 (6개 미만)
    const stockRows = dates.map((tradeDate, i) => ({ tradeDate, closePrice: 1000 + i }));
    const marketRows = dates.map((tradeDate) => ({ tradeDate, closeIndex: 2000 }));
    const svc = new SignalAccuracyService(
      makePrisma({
        signals: [
          { stockCode: 'X', eventType: 'E', buyScore: 70, signal: 'BUY_CANDIDATE', rcpDt: '20250101', market: 'KOSPI' },
        ],
        stockRows,
        marketRows,
      }),
    );
    const report = await svc.getSignalAccuracy();
    expect(report.realizedD5).toBe(0);
    expect(report.realizedD20).toBe(0);
    expect(report.byGrade[0].d5.avgExcessReturn).toBeNull();
  });

  it('disclosure rcpDt 또는 market 이 없으면 null', async () => {
    const dates = seqDates('20250101', 22);
    const stockRows = dates.map((tradeDate, i) => ({ tradeDate, closePrice: 1000 + i }));
    const marketRows = dates.map((tradeDate) => ({ tradeDate, closeIndex: 2000 }));
    const svc = new SignalAccuracyService(
      makePrisma({
        signals: [
          { stockCode: 'X', eventType: 'E', buyScore: 70, signal: 'BUY_CANDIDATE', rcpDt: null, market: 'KOSPI' },
          { stockCode: 'Y', eventType: 'E', buyScore: 70, signal: 'BUY_CANDIDATE', rcpDt: '20250101', market: null },
        ],
        stockRows,
        marketRows,
      }),
    );
    const report = await svc.getSignalAccuracy();
    expect(report.totalSignals).toBe(2);
    expect(report.realizedD5).toBe(0); // 둘 다 실현 불가
  });
});
