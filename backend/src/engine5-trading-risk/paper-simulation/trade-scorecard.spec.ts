import {
  buildTradeRationale,
  calculateTradeScorecard,
  holdDaysBetween,
  LOW_SAMPLE_THRESHOLD,
  TradeRationaleInput,
} from './trade-scorecard';

// 순수 함수 단위 검증 — 신규 수집·외부호출·AI 개입 없음(I/O 없는 변환만 검증).
describe('trade-scorecard', () => {
  function baseInput(over: Partial<TradeRationaleInput> = {}): TradeRationaleInput {
    return {
      positionId: 'p1',
      corpCode: '00126380',
      stockCode: '005930',
      corpName: '삼성전자',
      status: 'CLOSED',
      entryDate: new Date('2026-05-01T00:00:00.000Z'),
      entryPrice: 50000,
      quantity: 10,
      closedAt: new Date('2026-05-11T00:00:00.000Z'),
      pnl: 30000,
      pnlPct: 6,
      stopLossPct: 8,
      takeProfitPct: 20,
      maxHoldDays: 20,
      entryReason: '실적 서프라이즈 + 거래량 급증',
      initialThesis: ['영업이익 +30% YoY', 'BuyScore 82(상위 5%)'],
      exitAction: 'EXIT',
      exitTriggers: ['TAKE_PROFIT'],
      ...over,
    };
  }

  describe('holdDaysBetween', () => {
    it('두 일자 차이를 달력일수로 반올림한다', () => {
      expect(
        holdDaysBetween(new Date('2026-05-01T00:00:00Z'), new Date('2026-05-11T00:00:00Z')),
      ).toBe(10);
    });
    it('closedAt 이 없으면 null', () => {
      expect(holdDaysBetween(new Date('2026-05-01T00:00:00Z'), null)).toBeNull();
    });
    it('음수(역전)는 0으로 클램프', () => {
      expect(
        holdDaysBetween(new Date('2026-05-11T00:00:00Z'), new Date('2026-05-01T00:00:00Z')),
      ).toBe(0);
    });
  });

  describe('buildTradeRationale', () => {
    it('CLOSED: thesis 근거 + 룰 칩을 조합하고 청산 사유를 노출한다', () => {
      const r = buildTradeRationale(baseInput());
      expect(r.status).toBe('CLOSED');
      expect(r.entryReason).toBe('실적 서프라이즈 + 거래량 급증');
      expect(r.entryBasis).toEqual([
        '영업이익 +30% YoY',
        'BuyScore 82(상위 5%)',
        '손절 -8%',
        '익절 +20%',
        '최대보유 20일',
      ]);
      expect(r.exitAction).toBe('EXIT');
      expect(r.exitTriggers).toEqual(['TAKE_PROFIT']);
      expect(r.holdDays).toBe(10);
      expect(r.exitDate).toBe('2026-05-11T00:00:00.000Z');
      expect(r.pnl).toBe(30000);
    });

    it('OPEN: 청산 필드는 비우고 holdDays 는 null', () => {
      const r = buildTradeRationale(baseInput({ status: 'OPEN', closedAt: null, exitAction: 'HOLD' }));
      expect(r.status).toBe('OPEN');
      expect(r.exitAction).toBeNull();
      expect(r.exitTriggers).toEqual([]);
      expect(r.exitDate).toBeNull();
      expect(r.holdDays).toBeNull();
    });

    it('thesis 근거가 없으면 룰 칩만, entryReason 은 null(근거 기록 없음)', () => {
      const r = buildTradeRationale(
        baseInput({ entryReason: null, initialThesis: null, stopLossPct: 8, takeProfitPct: null, maxHoldDays: 20 }),
      );
      expect(r.entryReason).toBeNull();
      expect(r.entryBasis).toEqual(['손절 -8%', '최대보유 20일']);
    });

    it('initialThesis 가 비배열/잡값이면 안전하게 무시한다', () => {
      const r = buildTradeRationale(baseInput({ initialThesis: { foo: 'bar' }, stopLossPct: null, takeProfitPct: null, maxHoldDays: null }));
      expect(r.entryBasis).toEqual([]);
    });
  });

  describe('calculateTradeScorecard', () => {
    it('표본 0이면 winRate null·avgHoldDays null·lowSample true', () => {
      const sc = calculateTradeScorecard([], 10_000_000);
      expect(sc.closedCount).toBe(0);
      expect(sc.winRate).toBeNull();
      expect(sc.avgHoldDays).toBeNull();
      expect(sc.avgPnl).toBe(0);
      expect(sc.cumulativeReturnPct).toBe(0);
      expect(sc.lowSample).toBe(true);
    });

    it('승률·평균손익·평균보유·누적수익률을 집계한다', () => {
      const win = buildTradeRationale(baseInput({ positionId: 'a', pnl: 60000, pnlPct: 12, entryDate: new Date('2026-05-01T00:00:00Z'), closedAt: new Date('2026-05-09T00:00:00Z') }));
      const loss = buildTradeRationale(baseInput({ positionId: 'b', pnl: -20000, pnlPct: -4, entryDate: new Date('2026-05-01T00:00:00Z'), closedAt: new Date('2026-05-05T00:00:00Z') }));
      const sc = calculateTradeScorecard([win, loss], 10_000_000);
      expect(sc.closedCount).toBe(2);
      expect(sc.winCount).toBe(1);
      expect(sc.lossCount).toBe(1);
      expect(sc.winRate).toBe(0.5);
      expect(sc.avgPnl).toBe(20000); // (60000-20000)/2
      expect(sc.avgPnlPct).toBe(4); // (12-4)/2
      expect(sc.avgHoldDays).toBe(6); // (8+4)/2
      expect(sc.totalNetPnl).toBe(40000);
      expect(sc.cumulativeReturnPct).toBe(0.4); // 40000/10,000,000*100
      expect(sc.sampleSize).toBe(2);
      expect(sc.lowSample).toBe(true); // 2 < 5
    });

    it('표본이 임계치 이상이면 lowSample false', () => {
      const trades = Array.from({ length: LOW_SAMPLE_THRESHOLD }, (_, i) =>
        buildTradeRationale(baseInput({ positionId: `p${i}`, pnl: 1000, pnlPct: 1 })),
      );
      const sc = calculateTradeScorecard(trades, 10_000_000);
      expect(sc.closedCount).toBe(LOW_SAMPLE_THRESHOLD);
      expect(sc.lowSample).toBe(false);
      expect(sc.winRate).toBe(1);
    });
  });
});
