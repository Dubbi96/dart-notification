/**
 * IntradayScalpController 응답 계약 회귀 테스트 (DAR-417)
 *
 * 버그: getStatus/getTradeHistory 가 객체를 직접 반환 → 응답 top keys=[styleTag,...].
 *   그러나 모바일 simulation.service.ts 는 `r.data.data` 로 추출(ApiResponse<T> 계약) →
 *   `r.data.data`=undefined → React Query 'Query data cannot be undefined' throw.
 * 수정: strategy-track 컨트롤러와 동일하게 `{ success: true, data }` 로 래핑한다.
 *   이 스펙은 top keys=[success,data] 와 data===서비스 산출물을 결정론적으로 고정한다.
 */
import { IntradayScalpController } from './intraday-scalp.controller';
import type {
  IntradayScalpService,
  ScalpStatus,
  ScalpTradeHistory,
} from './intraday-scalp.service';

describe('IntradayScalpController — 응답 계약 {success,data} 래핑(DAR-417)', () => {
  const status: ScalpStatus = {
    styleTag: '분봉 단타',
    strategyKey: 'intraday-scalp',
    tagline: '거래량 돌파 + VWAP 단타',
    initialCapital: 10_000_000,
    openPositions: 1,
    closedTrades: 7,
    realizedPnl: 12_345,
    winRate: 0.4286,
    cumulativeReturnPct: 0.12,
    lowSample: true,
    lowSampleThreshold: 20,
    backtestable: false,
    roundTripCostPct: 0.31,
    takeProfitNetPct: 2.0,
    stopLossNetPct: -1.2,
    totalFees: 540,
    equityCurve: [
      { tradeDate: '20260622', realizedPnl: 12_345, cumulativeReturnPct: 0.12 },
    ],
  };

  const history: ScalpTradeHistory = {
    styleTag: '분봉 단타',
    strategyKey: 'intraday-scalp',
    tagline: '거래량 돌파 + VWAP 단타',
    roundTripCostPct: 0.31,
    trades: [
      {
        id: 'trade-1',
        stockCode: '005930',
        corpName: '삼성전자',
        tradeDate: '20260622',
        entryTs: '2026-06-22T00:30:00.000Z',
        exitTs: '2026-06-22T01:10:00.000Z',
        entryReason: 'VOLUME_BREAKOUT_VWAP',
        exitReason: 'TAKE_PROFIT',
        entryPrice: 105.05,
        exitPrice: 119.69,
        returnPct: 13.93,
        grossReturnPct: 14.24,
        netReturnPct: 13.93,
        netPnl: 12_345,
        totalFees: 540,
        status: 'CLOSED',
      },
    ],
  };

  function makeController(): IntradayScalpController {
    const service = {
      getStatus: jest.fn().mockResolvedValue(status),
      getTradeHistory: jest.fn().mockResolvedValue(history),
    } as unknown as IntradayScalpService;
    return new IntradayScalpController(service);
  }

  it('getStatus 는 { success, data } 로 래핑하고 data 는 서비스 산출물과 동일하다', async () => {
    const res = await makeController().getStatus();
    expect(Object.keys(res)).toEqual(['success', 'data']);
    expect(res.success).toBe(true);
    expect(res.data).toBe(status);
    // 모바일 r.data.data 추출 경로 재현 — undefined 가 아니어야 한다.
    expect(res.data).not.toBeUndefined();
    expect(res.data.closedTrades).toBe(7);
  });

  it('getTradeHistory 는 { success, data } 로 래핑하고 data 는 서비스 산출물과 동일하다', async () => {
    const res = await makeController().getTradeHistory();
    expect(Object.keys(res)).toEqual(['success', 'data']);
    expect(res.success).toBe(true);
    expect(res.data).toBe(history);
    expect(res.data).not.toBeUndefined();
    expect(res.data.trades).toHaveLength(1);
  });
});
